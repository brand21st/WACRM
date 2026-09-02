-- Live AI station: ElevenLabs v3 vs OpenAI Realtime (GPT) spoken voice.
SET search_path TO public, extensions;

ALTER TABLE calling_settings
  ADD COLUMN IF NOT EXISTS live_ai_voice text NOT NULL DEFAULT 'elevenlabs';

ALTER TABLE calling_settings
  DROP CONSTRAINT IF EXISTS calling_settings_live_ai_voice_check;
ALTER TABLE calling_settings
  ADD CONSTRAINT calling_settings_live_ai_voice_check
  CHECK (live_ai_voice IN ('elevenlabs', 'openai'));

COMMENT ON COLUMN calling_settings.live_ai_voice IS
  'Spoken voice on Live AI inbound calls: elevenlabs (Voice Agent v3 / Sarvam) or openai (Realtime GPT voice).';
