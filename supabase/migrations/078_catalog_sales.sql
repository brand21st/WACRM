-- ============================================================
-- 078_catalog_sales.sql — Phase 4 sales intelligence
--
-- Adds an account-scoped sales-automation flag and a
-- recommendation event log. Shopping context lives on
-- contact_ai_memory.facts.shopping (no new table).
--
-- Does NOT change catalog_products, embeddings, hybrid search,
-- Meta outbox, knowledge RAG, or Shopify tables.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS catalog_sales_automation text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_catalog_sales_automation_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_catalog_sales_automation_check
  CHECK (catalog_sales_automation IN ('off', 'shadow', 'on'));

COMMENT ON COLUMN ai_configs.catalog_sales_automation IS
  'off = Phase 3B recommend path; shadow = compute Phase 4 and log, return 3B; on = return Phase 4.';

CREATE TABLE IF NOT EXISTS catalog_recommendation_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id   uuid REFERENCES conversations(id) ON DELETE SET NULL,
  mode              text NOT NULL,
  seed_product_id   uuid REFERENCES catalog_products(id) ON DELETE SET NULL,
  product_id        uuid REFERENCES catalog_products(id) ON DELETE SET NULL,
  score             real,
  reasons           text[] NOT NULL DEFAULT '{}',
  event             text NOT NULL CHECK (event IN ('generated', 'shown')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_recommendation_events_account_created_idx
  ON catalog_recommendation_events (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS catalog_recommendation_events_conversation_created_idx
  ON catalog_recommendation_events (conversation_id, created_at DESC);

ALTER TABLE catalog_recommendation_events ENABLE ROW LEVEL SECURITY;

-- SELECT: any account member (inbox/settings visibility).
DROP POLICY IF EXISTS catalog_recommendation_events_select ON catalog_recommendation_events;
CREATE POLICY catalog_recommendation_events_select ON catalog_recommendation_events
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policies for `authenticated`: events are
-- written exclusively by the service role (auto-reply / live AI)
-- and are never mutated from the client.

COMMENT ON TABLE catalog_recommendation_events IS
  'Phase 4 recommend log. generated = service return; shown = cards sent. No click/purchase events.';
