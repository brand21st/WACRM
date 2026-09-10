-- ============================================================
-- 095 — Sales pattern effectiveness (Phase 6)
--
-- Records injected (not shadow) pattern usage and stores
-- observational effectiveness on existing sales_patterns.
-- Does not alter sales_events, Phase 4 discovery columns,
-- or ai_usage_log.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE sales_patterns
  ADD COLUMN IF NOT EXISTS effectiveness jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE sales_patterns
  ADD COLUMN IF NOT EXISTS retrieval_eligible boolean NOT NULL DEFAULT true;

ALTER TABLE sales_patterns
  ADD COLUMN IF NOT EXISTS last_effectiveness_at timestamptz;

COMMENT ON COLUMN sales_patterns.effectiveness IS
  'Phase 6 observational usage metrics. Does not replace Phase 4 evidence.successRate.';

COMMENT ON COLUMN sales_patterns.retrieval_eligible IS
  'Phase 6 retrieval gate. Phase 5 loads status=active AND retrieval_eligible=true. Default true.';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sales_pattern_effectiveness text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_sales_pattern_effectiveness_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_sales_pattern_effectiveness_check
  CHECK (sales_pattern_effectiveness IN ('off', 'shadow', 'on'));

COMMENT ON COLUMN ai_configs.sales_pattern_effectiveness IS
  'Phase 6: off/shadow = compute metrics, do not flip retrieval_eligible; on = write eligibility. Default off.';

CREATE TABLE IF NOT EXISTS sales_pattern_usages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pattern_id              uuid NOT NULL REFERENCES sales_patterns(id) ON DELETE CASCADE,
  conversation_id         uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id       uuid REFERENCES messages(id) ON DELETE SET NULL,
  used_at                 timestamptz NOT NULL,
  attribution_status      text NOT NULL DEFAULT 'unresolved'
    CHECK (attribution_status IN ('unresolved', 'success', 'failure')),
  attributed_event_id     uuid REFERENCES sales_events(id) ON DELETE SET NULL,
  attributed_event_type   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, pattern_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS sales_pattern_usages_account_used_idx
  ON sales_pattern_usages (account_id, used_at DESC);

CREATE INDEX IF NOT EXISTS sales_pattern_usages_account_conversation_idx
  ON sales_pattern_usages (account_id, conversation_id);

ALTER TABLE sales_pattern_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_pattern_usages_select ON sales_pattern_usages;
CREATE POLICY sales_pattern_usages_select ON sales_pattern_usages
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE sales_pattern_usages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE sales_pattern_usages TO service_role;

COMMENT ON TABLE sales_pattern_usages IS
  'Phase 6 injected pattern usage. No transcripts or PII. One row per account+pattern+conversation.';

CREATE TABLE IF NOT EXISTS pattern_effectiveness_cursors (
  account_id              uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_run_at             timestamptz,
  analyzer_version        text NOT NULL DEFAULT 'v1'
);

ALTER TABLE pattern_effectiveness_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pattern_effectiveness_cursors_select ON pattern_effectiveness_cursors;
CREATE POLICY pattern_effectiveness_cursors_select ON pattern_effectiveness_cursors
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE pattern_effectiveness_cursors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pattern_effectiveness_cursors TO service_role;

COMMENT ON TABLE pattern_effectiveness_cursors IS
  'Per-account watermark for Phase 6 effectiveness jobs. Service-role writes only.';
