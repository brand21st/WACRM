-- WhatsApp Calling hub: recordings, transcripts, post-call AI, per-account settings.
SET search_path TO public, extensions;

-- ============================================================
-- CALLS — recording / transcript / AI columns
-- ============================================================
ALTER TABLE calls
  ADD COLUMN IF NOT EXISTS recording_key text,
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS recording_bytes bigint,
  ADD COLUMN IF NOT EXISTS recorded_at timestamptz,
  ADD COLUMN IF NOT EXISTS transcript text,
  ADD COLUMN IF NOT EXISTS transcript_status text,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_followup_draft text,
  ADD COLUMN IF NOT EXISTS ai_status text,
  ADD COLUMN IF NOT EXISTS consent_announced boolean NOT NULL DEFAULT false;

ALTER TABLE calls
  DROP CONSTRAINT IF EXISTS calls_transcript_status_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_transcript_status_check
  CHECK (
    transcript_status IS NULL
    OR transcript_status IN ('pending', 'ready', 'failed', 'skipped')
  );

ALTER TABLE calls
  DROP CONSTRAINT IF EXISTS calls_ai_status_check;
ALTER TABLE calls
  ADD CONSTRAINT calls_ai_status_check
  CHECK (
    ai_status IS NULL
    OR ai_status IN ('pending', 'ready', 'failed', 'skipped')
  );

CREATE INDEX IF NOT EXISTS calls_account_created_idx
  ON calls (account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS calls_account_recorded_idx
  ON calls (account_id, recorded_at DESC)
  WHERE recording_key IS NOT NULL;

-- ============================================================
-- CALLING SETTINGS (one row per account)
-- ============================================================
CREATE TABLE IF NOT EXISTS calling_settings (
  account_id uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  recording_enabled boolean NOT NULL DEFAULT false,
  announce_recording boolean NOT NULL DEFAULT true,
  retention_days integer NOT NULL DEFAULT 30
    CHECK (retention_days >= 1 AND retention_days <= 365),
  transcribe_enabled boolean NOT NULL DEFAULT false,
  ai_enabled boolean NOT NULL DEFAULT false,
  ai_auto_send_followup boolean NOT NULL DEFAULT false,
  ring_timeout_seconds integer NOT NULL DEFAULT 45
    CHECK (ring_timeout_seconds >= 15 AND ring_timeout_seconds <= 120),
  answer_policy text NOT NULL DEFAULT 'any_agent'
    CHECK (answer_policy IN ('any_agent', 'assigned_only')),
  call_hours jsonb,
  call_icon_visibility text NOT NULL DEFAULT 'DEFAULT'
    CHECK (call_icon_visibility IN ('DEFAULT', 'DISABLE_ALL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE calling_settings IS
  'Per-account WhatsApp Calling hub settings. Enablement still mirrors whatsapp_config.calling_status.';

CREATE OR REPLACE FUNCTION public.update_calling_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calling_settings_updated_at ON calling_settings;
CREATE TRIGGER calling_settings_updated_at
  BEFORE UPDATE ON calling_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_calling_settings_updated_at();

ALTER TABLE calling_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calling_settings_select ON calling_settings;
CREATE POLICY calling_settings_select ON calling_settings
  FOR SELECT
  TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS calling_settings_write ON calling_settings;
CREATE POLICY calling_settings_write ON calling_settings
  FOR ALL
  TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

GRANT SELECT, INSERT, UPDATE ON calling_settings TO authenticated;
REVOKE DELETE ON calling_settings FROM authenticated;

INSERT INTO calling_settings (account_id)
SELECT wc.account_id
FROM whatsapp_config wc
WHERE wc.account_id IS NOT NULL
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================
-- STORAGE — private call recordings
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'call-recordings',
  'call-recordings',
  FALSE,
  52428800,
  ARRAY[
    'audio/webm',
    'audio/ogg',
    'audio/mpeg',
    'audio/mp4',
    'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Authenticated members can read objects under account-{account_id}/.
-- Writes go through the service role in API routes.
DROP POLICY IF EXISTS call_recordings_select ON storage.objects;
CREATE POLICY call_recordings_select ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'call-recordings'
    AND split_part(name, '/', 1) = 'account-' || (
      SELECT p.account_id::text
      FROM profiles p
      WHERE p.user_id = (SELECT auth.uid())
      LIMIT 1
    )
  );
