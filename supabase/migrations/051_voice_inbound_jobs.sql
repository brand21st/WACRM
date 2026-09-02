-- Inbound voice notes: persist the WhatsApp row immediately, then
-- transcribe + auto-reply from a cron drain. Overlapping customers
-- used to fail because Meta's media CDN 500'd when the webhook
-- downloaded many OGG files in one request (and Meta's ~20s webhook
-- timeout cannot wait for STT + TTS).
--
-- The webhook inserts messages + a pending job. GET /api/voice/cron
-- claims due rows (pending, or running abandoned past the stale
-- window) and runs STT / spoken reply off the request path.

CREATE TABLE IF NOT EXISTS voice_inbound_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  meta_message_id text NOT NULL,
  media_id text NOT NULL,
  mime_type text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  run_at timestamptz NOT NULL DEFAULT now(),
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id)
);

COMMENT ON TABLE voice_inbound_jobs IS
  'Queued inbound WhatsApp voice notes waiting for STT + AI reply.';

CREATE INDEX IF NOT EXISTS voice_inbound_jobs_due_idx
  ON voice_inbound_jobs (run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS voice_inbound_jobs_running_idx
  ON voice_inbound_jobs (updated_at)
  WHERE status = 'running';

ALTER TABLE voice_inbound_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_inbound_jobs_select ON voice_inbound_jobs;
CREATE POLICY voice_inbound_jobs_select ON voice_inbound_jobs
  FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS voice_inbound_jobs_insert ON voice_inbound_jobs;
CREATE POLICY voice_inbound_jobs_insert ON voice_inbound_jobs
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS voice_inbound_jobs_update ON voice_inbound_jobs;
CREATE POLICY voice_inbound_jobs_update ON voice_inbound_jobs
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS voice_inbound_jobs_delete ON voice_inbound_jobs;
CREATE POLICY voice_inbound_jobs_delete ON voice_inbound_jobs
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_voice_inbound_jobs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS voice_inbound_jobs_updated_at ON voice_inbound_jobs;
CREATE TRIGGER voice_inbound_jobs_updated_at
  BEFORE UPDATE ON voice_inbound_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_voice_inbound_jobs_updated_at();
