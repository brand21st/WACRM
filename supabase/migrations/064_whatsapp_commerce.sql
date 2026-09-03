-- ============================================================
-- 064_whatsapp_commerce.sql
--
-- WhatsApp native catalog + India Payments (Razorpay deep
-- integration) + Shopify paid-order create.
--
-- Adds Commerce columns on shopify_configs, a per-account
-- whatsapp_commerce_orders ledger, and 'order' on
-- messages.content_type for inbound WhatsApp carts.
--
-- RLS: members may read commerce orders; admin+ may write.
-- Webhooks use the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS retailer_id_source text NOT NULL DEFAULT 'sku';

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS meta_catalog_auto_sync boolean NOT NULL DEFAULT false;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS last_meta_catalog_sync_at timestamptz;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS meta_catalog_item_count integer NOT NULL DEFAULT 0;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS wa_payment_configuration_name text;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS razorpay_key_id text;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS razorpay_key_secret text;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS razorpay_webhook_secret text;

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS ship_beneficiary jsonb;

DO $$ BEGIN
  ALTER TABLE shopify_configs
    ADD CONSTRAINT shopify_configs_retailer_id_source_check
    CHECK (retailer_id_source IN ('sku', 'variant_id', 'facebook_shopify'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE shopify_configs
    ADD CONSTRAINT shopify_configs_meta_catalog_item_count_check
    CHECK (meta_catalog_item_count >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN shopify_configs.retailer_id_source IS
  'How Meta catalog retailer_id is derived from Shopify variants.';
COMMENT ON COLUMN shopify_configs.wa_payment_configuration_name IS
  'WhatsApp Manager payment configuration name (Razorpay).';
COMMENT ON COLUMN shopify_configs.razorpay_key_secret IS
  'AES-GCM encrypted Razorpay key secret; never returned to the client.';
COMMENT ON COLUMN shopify_configs.ship_beneficiary IS
  'Default India shipping beneficiary used on physical-goods order_details.';

CREATE TABLE IF NOT EXISTS whatsapp_commerce_orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id              uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id         uuid REFERENCES conversations(id) ON DELETE SET NULL,
  reference_id            text NOT NULL,
  catalog_id              text,
  status                  text NOT NULL DEFAULT 'pending',
  currency                text NOT NULL DEFAULT 'INR',
  total_value             integer NOT NULL DEFAULT 0,
  line_items              jsonb NOT NULL DEFAULT '[]'::jsonb,
  beneficiary             jsonb,
  payment_config_id       text,
  payment_id              text,
  pg_transaction          jsonb,
  razorpay_order_id       text,
  razorpay_payment_id     text,
  shopify_order_id        text,
  shopify_order_name      text,
  awaiting_address        boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, reference_id)
);

DO $$ BEGIN
  ALTER TABLE whatsapp_commerce_orders
    ADD CONSTRAINT whatsapp_commerce_orders_status_check
    CHECK (status IN (
      'pending',
      'processing',
      'partially_shipped',
      'shipped',
      'completed',
      'canceled'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_account_idx
  ON whatsapp_commerce_orders (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_conversation_idx
  ON whatsapp_commerce_orders (conversation_id)
  WHERE conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_shopify_idx
  ON whatsapp_commerce_orders (account_id, shopify_order_id)
  WHERE shopify_order_id IS NOT NULL;

ALTER TABLE whatsapp_commerce_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_commerce_orders_select ON whatsapp_commerce_orders;
CREATE POLICY whatsapp_commerce_orders_select ON whatsapp_commerce_orders FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS whatsapp_commerce_orders_insert ON whatsapp_commerce_orders;
CREATE POLICY whatsapp_commerce_orders_insert ON whatsapp_commerce_orders FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_commerce_orders_update ON whatsapp_commerce_orders;
CREATE POLICY whatsapp_commerce_orders_update ON whatsapp_commerce_orders FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_commerce_orders_delete ON whatsapp_commerce_orders;
CREATE POLICY whatsapp_commerce_orders_delete ON whatsapp_commerce_orders FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_whatsapp_commerce_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS whatsapp_commerce_orders_updated_at ON whatsapp_commerce_orders;
CREATE TRIGGER whatsapp_commerce_orders_updated_at
  BEFORE UPDATE ON whatsapp_commerce_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_whatsapp_commerce_orders_updated_at();

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'call', 'order'
  ));
