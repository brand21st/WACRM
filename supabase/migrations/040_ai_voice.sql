-- ============================================================
-- 040_ai_voice.sql — ElevenLabs speech layer on the AI assistant
--
-- Adds account-scoped voice configuration to `ai_configs`. OpenAI /
-- Anthropic remain the reply brain; ElevenLabs is used only for
-- speech-to-text (inbound voice notes + playground push-to-talk) and
-- text-to-speech (spoken replies).
--
-- Transcripts live in the existing `messages.content_text` column on
-- audio rows — no duplicate transcript column. Empty content_text on
-- an audio row means STT was skipped or failed; the voice note is
-- still kept for a human.
--
-- Columns
--   elevenlabs_api_key     — BYO key, AES-256-GCM at rest (same
--                            encrypt()/decrypt() as api_key). Never
--                            returned to the client.
--   elevenlabs_voice_id    — ElevenLabs voice to speak with. NULL
--                            means the app default.
--   stt_enabled            — transcribe inbound WhatsApp voice notes
--                            and playground recordings.
--   tts_enabled            — speak auto-replies / playground replies.
--   voice_reply_mode       — how WhatsApp auto-replies are delivered:
--                              same  = match inbound (text→text,
--                                      voice→voice)
--                              text  = always text
--                              audio = always voice
--                              both  = text + voice
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS elevenlabs_api_key text,
  ADD COLUMN IF NOT EXISTS elevenlabs_voice_id text,
  ADD COLUMN IF NOT EXISTS stt_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS tts_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS voice_reply_mode text NOT NULL DEFAULT 'same';

COMMENT ON COLUMN ai_configs.elevenlabs_api_key IS
  'BYO ElevenLabs API key, AES-256-GCM encrypted. Used for STT/TTS only; never returned to clients.';

COMMENT ON COLUMN ai_configs.elevenlabs_voice_id IS
  'ElevenLabs voice id for spoken replies. NULL uses the application default.';

COMMENT ON COLUMN ai_configs.stt_enabled IS
  'When true, inbound WhatsApp voice notes and playground recordings are transcribed.';

COMMENT ON COLUMN ai_configs.tts_enabled IS
  'When true, auto-replies and playground replies may be spoken via ElevenLabs TTS.';

COMMENT ON COLUMN ai_configs.voice_reply_mode IS
  'WhatsApp auto-reply delivery: same (match inbound), text, audio, or both.';

DO $$
BEGIN
  ALTER TABLE ai_configs
    ADD CONSTRAINT ai_configs_voice_reply_mode_check
    CHECK (voice_reply_mode IN ('same', 'text', 'audio', 'both'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
