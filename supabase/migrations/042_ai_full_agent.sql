-- ============================================================
-- 042_ai_full_agent.sql — Fully automated inbox AI agent mode
--
-- When enabled, the AI agent owns inbound threads: text, voice notes,
-- and images (via vision). Flows and keyword automations stand down so
-- the LLM can reply without deterministic handlers stealing the turn.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS full_agent_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ai_configs.full_agent_enabled IS
  'When true, the AI agent fully automates replies (text, voice, images) and bypasses flows/automations.';
