-- ============================================================
-- 044_ai_realtime_voice.sql — OpenAI Realtime for WhatsApp voice
--
-- Optional account toggle: when enabled (OpenAI provider only),
-- WhatsApp auto-replies generate spoken audio in one Realtime
-- session instead of LLM text + ElevenLabs TTS. ElevenLabs stays
-- the fallback. Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS realtime_voice_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS realtime_voice text;

COMMENT ON COLUMN ai_configs.realtime_voice_enabled IS
  'When true and provider is openai, WhatsApp auto-replies use the OpenAI Realtime API for spoken voice notes.';

COMMENT ON COLUMN ai_configs.realtime_voice IS
  'OpenAI Realtime TTS voice id (alloy, marin, …). Null uses the application default.';
