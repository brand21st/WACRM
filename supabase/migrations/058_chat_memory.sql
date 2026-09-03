-- Per-customer chat memory: a rolling profile plus append-only
-- session recaps. The WhatsApp AI only sees the last ~20 messages
-- at reply time; cron summarizes older / idle turns here so the
-- next session still knows what the customer needs.
--
-- One conversation per (account, contact). A "session" is an idle
-- gap in that same thread, not a new conversations row.

CREATE TABLE IF NOT EXISTS contact_ai_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  profile_summary text NOT NULL DEFAULT '',
  last_session_summary text NOT NULL DEFAULT '',
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  summarized_through_at timestamptz,
  message_count_at_summary integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contact_id)
);

COMMENT ON TABLE contact_ai_memory IS
  'Rolling AI profile for one WhatsApp contact (needs, prefs, last session).';

CREATE INDEX IF NOT EXISTS contact_ai_memory_account_idx
  ON contact_ai_memory (account_id);

CREATE INDEX IF NOT EXISTS contact_ai_memory_conversation_idx
  ON contact_ai_memory (conversation_id);

CREATE TABLE IF NOT EXISTS conversation_session_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES conversations (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  summary text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversation_session_summaries IS
  'Append-only recap of one idle WhatsApp chat session. Keep last 10 in app.';

CREATE INDEX IF NOT EXISTS conversation_session_summaries_contact_ended_idx
  ON conversation_session_summaries (contact_id, ended_at DESC);

CREATE INDEX IF NOT EXISTS conversation_session_summaries_account_idx
  ON conversation_session_summaries (account_id);

CREATE INDEX IF NOT EXISTS conversation_session_summaries_conversation_idx
  ON conversation_session_summaries (conversation_id);

CREATE INDEX IF NOT EXISTS messages_conversation_created_at_idx
  ON messages (conversation_id, created_at DESC);

ALTER TABLE contact_ai_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_session_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_ai_memory_select ON contact_ai_memory;
CREATE POLICY contact_ai_memory_select ON contact_ai_memory
  FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS contact_ai_memory_insert ON contact_ai_memory;
CREATE POLICY contact_ai_memory_insert ON contact_ai_memory
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_ai_memory_update ON contact_ai_memory;
CREATE POLICY contact_ai_memory_update ON contact_ai_memory
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS contact_ai_memory_delete ON contact_ai_memory;
CREATE POLICY contact_ai_memory_delete ON contact_ai_memory
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversation_session_summaries_select ON conversation_session_summaries;
CREATE POLICY conversation_session_summaries_select ON conversation_session_summaries
  FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_session_summaries_insert ON conversation_session_summaries;
CREATE POLICY conversation_session_summaries_insert ON conversation_session_summaries
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversation_session_summaries_update ON conversation_session_summaries;
CREATE POLICY conversation_session_summaries_update ON conversation_session_summaries
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS conversation_session_summaries_delete ON conversation_session_summaries;
CREATE POLICY conversation_session_summaries_delete ON conversation_session_summaries
  FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_contact_ai_memory_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contact_ai_memory_updated_at ON contact_ai_memory;
CREATE TRIGGER contact_ai_memory_updated_at
  BEFORE UPDATE ON contact_ai_memory
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contact_ai_memory_updated_at();
