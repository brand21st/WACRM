-- ============================================================
-- 079_catalog_management.sql — product management analytics
--
-- Adds:
--   1. ai_configs.catalog_analytics (off|on, default off)
--   2. catalog_product_events (account-scoped, service-role writes)
--   3. catalog_media.storage_path for owned chat-media objects
--
-- Does NOT change catalog_products schema, Meta outbox, embeddings,
-- catalog_recommendation_events, or Shopify tables.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS catalog_analytics text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_catalog_analytics_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_catalog_analytics_check
  CHECK (catalog_analytics IN ('off', 'on'));

COMMENT ON COLUMN ai_configs.catalog_analytics IS
  'off = do not persist catalog product events or show the analytics dashboard; on = record and display practical catalog analytics.';

ALTER TABLE catalog_media
  ADD COLUMN IF NOT EXISTS storage_path text;

CREATE TABLE IF NOT EXISTS catalog_product_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id        uuid REFERENCES catalog_products(id) ON DELETE SET NULL,
  variant_id        uuid REFERENCES catalog_variants(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  event             text NOT NULL
                      CHECK (event IN ('search_match', 'shown', 'add_to_cart', 'purchase')),
  quantity          integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  source            text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_product_events_account_event_created_idx
  ON catalog_product_events (account_id, event, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_product_events_account_product_event_created_idx
  ON catalog_product_events (account_id, product_id, event, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_product_events_account_conversation_created_idx
  ON catalog_product_events (account_id, conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

ALTER TABLE catalog_product_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_product_events_select ON catalog_product_events;
CREATE POLICY catalog_product_events_select ON catalog_product_events
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policies for `authenticated`: events are
-- written exclusively by the service role (AI tools / commerce) and
-- are never mutated from the client.

GRANT SELECT ON TABLE catalog_product_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE catalog_product_events TO service_role;

COMMENT ON TABLE catalog_product_events IS
  'Practical catalog analytics. search_match = catalog tool hit; shown = card sent; add_to_cart / purchase = WhatsApp commerce lines. No raw message text.';
