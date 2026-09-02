-- Live WhatsApp Voice Call AI: auto-answer policy + AI-answered flag.
SET search_path TO public, extensions;

ALTER TABLE calling_settings
  ADD COLUMN IF NOT EXISTS live_ai_answer text NOT NULL DEFAULT 'off';

ALTER TABLE calling_settings
  DROP CONSTRAINT IF EXISTS calling_settings_live_ai_answer_check;
ALTER TABLE calling_settings
  ADD CONSTRAINT calling_settings_live_ai_answer_check
  CHECK (live_ai_answer IN ('off', 'ai_first', 'after_timeout'));

COMMENT ON COLUMN calling_settings.live_ai_answer IS
  'How the Live AI station answers inbound WhatsApp calls: off, immediately (ai_first), or after ring_timeout_seconds (after_timeout, capped under Meta''s accept window).';

ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS ai_answered boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN calls.ai_answered IS
  'True when the Live AI station claimed this call. answered_by is still the station user.';
