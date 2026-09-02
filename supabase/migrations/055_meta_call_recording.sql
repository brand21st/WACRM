-- Meta Calling API recording: purpose + announcement locale sent on accept.
SET search_path TO public, extensions;

ALTER TABLE calling_settings
  ADD COLUMN IF NOT EXISTS recording_purpose text NOT NULL
    DEFAULT 'quality and training purposes';

ALTER TABLE calling_settings
  DROP CONSTRAINT IF EXISTS calling_settings_recording_purpose_len;
ALTER TABLE calling_settings
  ADD CONSTRAINT calling_settings_recording_purpose_len
  CHECK (char_length(recording_purpose) BETWEEN 1 AND 250);

COMMENT ON COLUMN calling_settings.recording_purpose IS
  'Spoken after Meta''s recording announcement prefix. Max 250 characters.';

ALTER TABLE calling_settings
  ADD COLUMN IF NOT EXISTS recording_announcement_language text NOT NULL
    DEFAULT 'en_US';

ALTER TABLE calling_settings
  DROP CONSTRAINT IF EXISTS calling_settings_recording_announcement_language_check;
ALTER TABLE calling_settings
  ADD CONSTRAINT calling_settings_recording_announcement_language_check
  CHECK (
    recording_announcement_language IN (
      'en', 'en_US', 'en_AU', 'en_CA', 'en_GB', 'en_IN', 'en_NZ',
      'nl', 'fr', 'de', 'hi', 'it', 'kn', 'pt', 'es', 'es_ES', 'te', 'vi'
    )
  );

COMMENT ON COLUMN calling_settings.recording_announcement_language IS
  'Meta Calling API announcement_language locale. Korean is not supported by Meta.';
