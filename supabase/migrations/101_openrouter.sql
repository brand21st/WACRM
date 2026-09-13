-- ============================================================
-- 101_openrouter.sql — OpenRouter as a platform chat provider
--
-- Adds openrouter_api_key to platform_ai_settings and extends the
-- chat_provider CHECK constraint to allow 'openrouter' alongside
-- 'openai' and 'anthropic'.
-- ============================================================

ALTER TABLE platform_ai_settings
  ADD COLUMN IF NOT EXISTS openrouter_api_key text;

-- Drop the old 2-value constraint and replace with a 3-value one.
ALTER TABLE platform_ai_settings
  DROP CONSTRAINT IF EXISTS platform_ai_settings_chat_provider_check;

ALTER TABLE platform_ai_settings
  ADD CONSTRAINT platform_ai_settings_chat_provider_check
  CHECK (chat_provider IN ('openai', 'anthropic', 'openrouter'));
