-- Live AI station: call-only behaviour, business context, and instructions.
SET search_path TO public, extensions;

ALTER TABLE calling_settings
  ADD COLUMN IF NOT EXISTS live_ai_behaviour text,
  ADD COLUMN IF NOT EXISTS live_ai_business_context text,
  ADD COLUMN IF NOT EXISTS live_ai_instructions text;

COMMENT ON COLUMN calling_settings.live_ai_behaviour IS
  'Tone and persona for Live AI inbound voice calls. Empty inherits Chat Agent system_prompt.';
COMMENT ON COLUMN calling_settings.live_ai_business_context IS
  'Business facts for Live AI inbound voice calls. Empty inherits Chat Agent system_prompt.';
COMMENT ON COLUMN calling_settings.live_ai_instructions IS
  'Must / must-not rules for Live AI inbound voice calls. Empty inherits Chat Agent system_prompt.';
