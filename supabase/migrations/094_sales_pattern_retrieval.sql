-- ============================================================
-- 094 — Sales pattern retrieval flag (Phase 5)
--
-- Adds an account-scoped off/shadow/on switch for retrieving
-- existing active sales_patterns into live auto-reply.
-- Default is off. Does not alter sales_patterns, sales_events,
-- or discovery jobs.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sales_pattern_retrieval text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_sales_pattern_retrieval_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_sales_pattern_retrieval_check
  CHECK (sales_pattern_retrieval IN ('off', 'shadow', 'on'));

COMMENT ON COLUMN ai_configs.sales_pattern_retrieval IS
  'Phase 5: off = no retrieve; shadow = retrieve and log, do not inject; on = inject max 3 active patterns as behavioral hints. Default off.';
