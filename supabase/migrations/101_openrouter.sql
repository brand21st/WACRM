-- ============================================================
-- 101_openrouter.sql — OpenRouter as a platform chat provider
--
-- Adds openrouter_api_key to platform_ai_settings and extends the
-- provider CHECK constraints across platform_ai_settings, ai_configs,
-- and ai_usage_log to allow 'openrouter' alongside 'openai' and 'anthropic'.
-- ============================================================

-- 1. platform_ai_settings: column + constraint
ALTER TABLE platform_ai_settings
  ADD COLUMN IF NOT EXISTS openrouter_api_key text;

ALTER TABLE platform_ai_settings
  DROP CONSTRAINT IF EXISTS platform_ai_settings_chat_provider_check;

ALTER TABLE platform_ai_settings
  ADD CONSTRAINT platform_ai_settings_chat_provider_check
  CHECK (chat_provider IN ('openai', 'anthropic', 'openrouter'));

-- 2. ai_configs: allow 'openrouter' as provider
ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_provider_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

-- 3. ai_usage_log: allow 'openrouter' as provider
ALTER TABLE ai_usage_log
  DROP CONSTRAINT IF EXISTS ai_usage_log_provider_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_provider_check
  CHECK (provider IN ('openai', 'anthropic', 'openrouter'));

