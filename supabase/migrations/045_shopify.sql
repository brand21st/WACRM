-- ============================================================
-- 045_shopify.sql — per-account Shopify store + catalog snapshot
--
-- One Shopify custom-app connection per workspace (same pattern as
-- `whatsapp_config` / `ai_configs`). The Admin API token is stored
-- AES-256-GCM-encrypted and never returned to the client.
--
-- `shopify_catalog_products` is a local snapshot of the store catalog
-- so WhatsApp auto-reply can search new arrivals / match photos without
-- hitting Shopify on every inbound. Sync is admin-triggered.
--
-- RLS: any member may read (inbox/agent needs to know if Shopify is
-- live); admin+ may write. The webhook uses the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_configs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  shop_domain             text NOT NULL,
  access_token            text NOT NULL,
  is_active               boolean NOT NULL DEFAULT true,
  shop_name               text,
  primary_domain          text,
  currency                text,
  meta_catalog_id         text,
  last_verified_at        timestamptz,
  last_catalog_sync_at    timestamptz,
  catalog_product_count   integer NOT NULL DEFAULT 0
                            CHECK (catalog_product_count >= 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shopify_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_configs_select ON shopify_configs;
CREATE POLICY shopify_configs_select ON shopify_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_configs_insert ON shopify_configs;
CREATE POLICY shopify_configs_insert ON shopify_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_configs_update ON shopify_configs;
CREATE POLICY shopify_configs_update ON shopify_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_configs_delete ON shopify_configs;
CREATE POLICY shopify_configs_delete ON shopify_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_shopify_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shopify_configs_updated_at ON shopify_configs;
CREATE TRIGGER shopify_configs_updated_at
  BEFORE UPDATE ON shopify_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shopify_configs_updated_at();

CREATE TABLE IF NOT EXISTS shopify_catalog_products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shopify_product_id    text NOT NULL,
  handle                text NOT NULL,
  title                 text NOT NULL,
  body_excerpt          text,
  price_min             numeric,
  price_max             numeric,
  currency              text,
  variant_summary       jsonb NOT NULL DEFAULT '[]'::jsonb,
  image_url             text,
  product_url           text,
  published_at          timestamptz,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS shopify_catalog_products_published_idx
  ON shopify_catalog_products (account_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS shopify_catalog_products_title_idx
  ON shopify_catalog_products (account_id, title);

ALTER TABLE shopify_catalog_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_catalog_products_select ON shopify_catalog_products;
CREATE POLICY shopify_catalog_products_select ON shopify_catalog_products FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_catalog_products_insert ON shopify_catalog_products;
CREATE POLICY shopify_catalog_products_insert ON shopify_catalog_products FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_catalog_products_update ON shopify_catalog_products;
CREATE POLICY shopify_catalog_products_update ON shopify_catalog_products FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_catalog_products_delete ON shopify_catalog_products;
CREATE POLICY shopify_catalog_products_delete ON shopify_catalog_products FOR DELETE
  USING (is_account_member(account_id, 'admin'));
