-- WhatsApp Cloud API user-initiated (inbound) calling.
-- Live call state + SDP live in `calls`. Thread history is a
-- messages row with content_type = 'call' (message_id = Meta wacid).
SET search_path TO public, extensions;

-- ============================================================
-- CALLS
-- ============================================================
CREATE TABLE IF NOT EXISTS calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE CASCADE,
  contact_id uuid REFERENCES contacts (id) ON DELETE SET NULL,
  meta_call_id text NOT NULL UNIQUE,
  direction text NOT NULL DEFAULT 'user_initiated'
    CHECK (direction IN ('user_initiated', 'business_initiated')),
  status text NOT NULL
    CHECK (status IN (
      'ringing',
      'connecting',
      'in_progress',
      'completed',
      'missed',
      'rejected',
      'failed'
    )),
  answered_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  from_phone text,
  to_phone text,
  -- Meta's SDP offer from the Call Connect webhook. Needed by the
  -- answering browser; not logged in app code.
  sdp_offer text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  error_code integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE calls IS
  'WhatsApp Cloud API call sessions. Signaling via Graph + webhooks; media is WebRTC in the agent browser.';

CREATE INDEX IF NOT EXISTS calls_conversation_id_idx
  ON calls (conversation_id);

CREATE INDEX IF NOT EXISTS calls_account_ringing_idx
  ON calls (account_id)
  WHERE status = 'ringing';

ALTER TABLE calls REPLICA IDENTITY FULL;

ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calls_select ON calls;
CREATE POLICY calls_select ON calls
  FOR SELECT
  USING (is_account_member(account_id));

-- Inserts/updates go through the webhook and authenticated API routes
-- with the service role. Authenticated clients must not write SDP or
-- claim a call around RLS.
REVOKE INSERT, UPDATE, DELETE ON calls FROM authenticated;
GRANT SELECT ON calls TO authenticated;

CREATE OR REPLACE FUNCTION public.update_calls_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calls_updated_at ON calls;
CREATE TRIGGER calls_updated_at
  BEFORE UPDATE ON calls
  FOR EACH ROW
  EXECUTE FUNCTION public.update_calls_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'calls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE calls;
  END IF;
END $$;

-- ============================================================
-- WHATSAPP CONFIG — calling enablement
-- ============================================================
ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS calling_status text NOT NULL DEFAULT 'disabled';

ALTER TABLE whatsapp_config
  DROP CONSTRAINT IF EXISTS whatsapp_config_calling_status_check;

ALTER TABLE whatsapp_config
  ADD CONSTRAINT whatsapp_config_calling_status_check
  CHECK (calling_status IN ('enabled', 'disabled'));

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS last_calling_error text;

COMMENT ON COLUMN whatsapp_config.calling_status IS
  'Mirror of Meta call settings status (ENABLED/DISABLED) for this business number.';

-- ============================================================
-- MESSAGES — call history bubbles
-- ============================================================
ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_type_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_content_type_check
  CHECK (content_type IN (
    'text', 'image', 'document', 'audio', 'video',
    'location', 'template', 'interactive', 'call'
  ));
