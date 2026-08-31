-- ============================================================
-- 049_sarvam_voice.sql — Sarvam as a second BYO speech provider
--
-- Voice Agent can speak/hear with ElevenLabs (existing columns) or
-- Sarvam (Saaras STT + Bulbul TTS). `voice_provider` picks which
-- key the runtime uses. Existing rows stay on ElevenLabs.
--
-- Keys are AES-256-GCM-encrypted at rest and never returned to the
-- client (same posture as elevenlabs_api_key).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS voice_provider text NOT NULL DEFAULT 'elevenlabs';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sarvam_api_key text;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sarvam_speaker text NOT NULL DEFAULT 'shubh';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sarvam_language_code text NOT NULL DEFAULT 'en-IN';

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sarvam_pace double precision NOT NULL DEFAULT 1.0;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS sarvam_temperature double precision NOT NULL DEFAULT 0.6;

DO $$
BEGIN
  ALTER TABLE ai_configs
    ADD CONSTRAINT ai_configs_voice_provider_check
    CHECK (voice_provider IN ('elevenlabs', 'sarvam'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE ai_configs
    ADD CONSTRAINT ai_configs_sarvam_pace_check
    CHECK (sarvam_pace >= 0.5 AND sarvam_pace <= 2.0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE ai_configs
    ADD CONSTRAINT ai_configs_sarvam_temperature_check
    CHECK (sarvam_temperature >= 0.01 AND sarvam_temperature <= 2.0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

COMMENT ON COLUMN ai_configs.voice_provider IS
  'Which BYO speech layer to use: elevenlabs or sarvam.';

COMMENT ON COLUMN ai_configs.sarvam_api_key IS
  'BYO Sarvam subscription key, AES-256-GCM encrypted. Never returned to clients.';

COMMENT ON COLUMN ai_configs.sarvam_speaker IS
  'Bulbul v3 speaker id (shubh, priya, …) or a Studio-cloned speaker id.';

COMMENT ON COLUMN ai_configs.sarvam_language_code IS
  'BCP-47 language for Sarvam TTS (hi-IN, en-IN, ta-IN, …).';

COMMENT ON COLUMN ai_configs.sarvam_pace IS
  'Bulbul v3 speech pace, 0.5–2.0. Default 1.0.';

COMMENT ON COLUMN ai_configs.sarvam_temperature IS
  'Bulbul v3 expressiveness, 0.01–2.0. Default 0.6.';
