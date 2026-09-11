-- ============================================================
-- 099 — Shadow retrieval diagnostics (observation only)
--
-- Phase 5 shadow mode may persist PII-free match diagnostics so
-- operators can inspect retrieval quality. Live replies do not
-- read this table. Service-role writes only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS sales_pattern_shadow_diagnostics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  turn_id         uuid NOT NULL,
  pattern_id      uuid REFERENCES sales_patterns(id) ON DELETE SET NULL,
  pattern_type    text,
  match_score     numeric,
  match_reasons   jsonb NOT NULL DEFAULT '[]'::jsonb,
  injected        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_pattern_shadow_diagnostics_account_created_idx
  ON sales_pattern_shadow_diagnostics (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sales_pattern_shadow_diagnostics_account_pattern_idx
  ON sales_pattern_shadow_diagnostics (account_id, pattern_id);

ALTER TABLE sales_pattern_shadow_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_pattern_shadow_diagnostics_select
  ON sales_pattern_shadow_diagnostics;
CREATE POLICY sales_pattern_shadow_diagnostics_select
  ON sales_pattern_shadow_diagnostics
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

GRANT SELECT ON TABLE sales_pattern_shadow_diagnostics TO authenticated;
GRANT ALL ON TABLE sales_pattern_shadow_diagnostics TO service_role;
