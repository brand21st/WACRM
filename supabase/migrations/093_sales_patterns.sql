-- ============================================================
-- 093 — Tenant sales patterns (Phase 4)
--
-- Aggregates Phase 3 sales_events into account-scoped patterns.
-- Live auto-reply does not read this table (Phase 5 retrieval).
-- Service-role writes only (same pattern as sales_events).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_patterns (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pattern_key             text NOT NULL,
  pattern_type            text NOT NULL,
  trigger_event_type      text NOT NULL,
  context                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_behavior    text NOT NULL,
  evidence                jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence              numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  sample_count            integer NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  success_count           integer NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  failure_count           integer NOT NULL DEFAULT 0 CHECK (failure_count >= 0),
  eligible_outcome_count  integer NOT NULL DEFAULT 0 CHECK (eligible_outcome_count >= 0),
  unresolved_count        integer NOT NULL DEFAULT 0 CHECK (unresolved_count >= 0),
  status                  text NOT NULL CHECK (status IN (
    'candidate',
    'active',
    'stale',
    'archived'
  )),
  analyzer_version        text NOT NULL DEFAULT 'v1',
  first_observed_at       timestamptz,
  last_observed_at        timestamptz,
  last_evaluated_at       timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, pattern_key),
  CONSTRAINT sales_patterns_pattern_type_check CHECK (pattern_type IN (
    'PRICE_OBJECTION',
    'PRODUCT_OBJECTION',
    'PRODUCT_COMPARISON',
    'PURCHASE_INTENT',
    'PRODUCT_INQUIRY',
    'DISCOUNT_REQUEST',
    'SHIPPING_CONCERN',
    'RETURN_CONCERN',
    'GENERAL_SALES'
  )),
  CONSTRAINT sales_patterns_behavior_check CHECK (recommended_behavior IN (
    'OFFER_RELEVANT_ALTERNATIVE',
    'SHOW_ALTERNATIVES',
    'COMPARE_PRODUCTS',
    'CONFIRM_AND_CHECKOUT',
    'ANSWER_THEN_OFFER',
    'EXPLAIN_VALUE_BEFORE_DISCOUNT',
    'EXPLAIN_SHIPPING',
    'EXPLAIN_RETURNS',
    'CONTINUE_DISCOVERY'
  ))
);

CREATE INDEX IF NOT EXISTS sales_patterns_account_status_observed_idx
  ON sales_patterns (account_id, status, last_observed_at DESC);

CREATE INDEX IF NOT EXISTS sales_patterns_account_type_idx
  ON sales_patterns (account_id, pattern_type);

ALTER TABLE sales_patterns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_patterns_select ON sales_patterns;
CREATE POLICY sales_patterns_select ON sales_patterns
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE sales_patterns TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sales_patterns TO service_role;

COMMENT ON TABLE sales_patterns IS
  'Phase 4 tenant sales patterns. Evidence-backed, account-scoped. No raw transcripts or PII. Live prompts do not read this table yet.';

CREATE TABLE IF NOT EXISTS pattern_discovery_cursors (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_event_created_at   timestamptz,
  last_run_at             timestamptz,
  analyzer_version        text NOT NULL DEFAULT 'v1'
);

ALTER TABLE pattern_discovery_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pattern_discovery_cursors_select ON pattern_discovery_cursors;
CREATE POLICY pattern_discovery_cursors_select ON pattern_discovery_cursors
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE pattern_discovery_cursors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pattern_discovery_cursors TO service_role;

COMMENT ON TABLE pattern_discovery_cursors IS
  'Per-account watermark for Phase 4 pattern discovery. Service-role writes only.';
