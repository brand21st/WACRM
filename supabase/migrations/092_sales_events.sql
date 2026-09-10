-- ============================================================
-- 092 — Conversation intelligence: sales_events + analysis cursors
--
-- Phase 3 stores tenant-scoped conversation signals and verified
-- commerce outcomes. Live auto-reply does not read this table.
-- Service-role writes only (same pattern as catalog_product_events).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  contact_id          uuid REFERENCES contacts(id) ON DELETE SET NULL,
  source_message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  source_table        text,
  source_id           text,
  event_type          text NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('signal', 'outcome')),
  confidence          numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  analyzer_version    text NOT NULL DEFAULT 'v1',
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_events_event_type_check CHECK (event_type IN (
    'PRODUCT_SELECTED',
    'VARIANT_SELECTED',
    'CART_CREATED',
    'CHECKOUT_STARTED',
    'ORDER_CREATED',
    'PAYMENT_COMPLETED',
    'ORDER_CANCELLED',
    'CHECKOUT_ABANDONED',
    'HUMAN_TAKEOVER',
    'PURCHASE_INTENT',
    'READY_TO_BUY',
    'PRICE_OBJECTION',
    'PRODUCT_OBJECTION',
    'PRODUCT_COMPARISON',
    'PRICE_INQUIRY',
    'AVAILABILITY_INQUIRY',
    'SIZE_INQUIRY',
    'COLOR_INQUIRY',
    'PRODUCT_INQUIRY',
    'CUSTOMER_INTENT',
    'HESITATION',
    'OBJECTION',
    'DISCOUNT_REQUEST',
    'SHIPPING_INQUIRY',
    'RETURN_INQUIRY',
    'REFUND_INQUIRY',
    'PAYMENT_INQUIRY',
    'NEEDS_MORE_INFORMATION',
    'HIGH_INTENT',
    'INTERESTED',
    'TRUST_CONCERN'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_events_message_type_uidx
  ON sales_events (account_id, conversation_id, source_message_id, event_type)
  WHERE source_message_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_events_source_type_uidx
  ON sales_events (account_id, event_type, source_table, source_id)
  WHERE source_message_id IS NULL;

CREATE INDEX IF NOT EXISTS sales_events_account_conversation_created_idx
  ON sales_events (account_id, conversation_id, created_at DESC);

ALTER TABLE sales_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_events_select ON sales_events;
CREATE POLICY sales_events_select ON sales_events
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

-- No INSERT/UPDATE/DELETE policies for `authenticated`: events are
-- written exclusively by the service-role analyzer worker.
GRANT SELECT ON TABLE sales_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sales_events TO service_role;

COMMENT ON TABLE sales_events IS
  'Phase 3 conversation intelligence. Structured signals and verified commerce outcomes. IDs + small metadata only — no raw transcript or PII.';

CREATE TABLE IF NOT EXISTS conversation_analysis_cursors (
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id         uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_source_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  last_analyzed_at        timestamptz,
  analyzer_version        text NOT NULL DEFAULT 'v1',
  PRIMARY KEY (account_id, conversation_id)
);

ALTER TABLE conversation_analysis_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_analysis_cursors_select ON conversation_analysis_cursors;
CREATE POLICY conversation_analysis_cursors_select ON conversation_analysis_cursors
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE conversation_analysis_cursors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE conversation_analysis_cursors TO service_role;

COMMENT ON TABLE conversation_analysis_cursors IS
  'Per-conversation watermark for the Phase 3 analyzer. Service-role writes only.';
