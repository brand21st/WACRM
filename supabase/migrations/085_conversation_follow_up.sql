-- One context-aware WhatsApp follow-up after an AI reply, if the
-- customer stays silent. Default OFF. Delay is 1–1440 minutes.

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS follow_up_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS follow_up_delay_minutes integer NOT NULL DEFAULT 30;

ALTER TABLE ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_follow_up_delay_check;

ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_follow_up_delay_check
  CHECK (follow_up_delay_minutes BETWEEN 1 AND 1440);

COMMENT ON COLUMN ai_configs.follow_up_enabled IS
  'When true, schedule one conversation follow-up after an AI reply if the customer stays silent.';

COMMENT ON COLUMN ai_configs.follow_up_delay_minutes IS
  'Minutes to wait after an AI reply before a follow-up (1–1440). Default 30.';

CREATE TABLE IF NOT EXISTS conversation_follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  triggering_message_id uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'skipped')),
  skip_reason text,
  sent_message_id uuid REFERENCES messages (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE conversation_follow_ups IS
  'At most one pending automatic follow-up per conversation; sent at most once per triggering AI reply.';

CREATE UNIQUE INDEX IF NOT EXISTS conversation_follow_ups_one_pending
  ON conversation_follow_ups (conversation_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS conversation_follow_ups_one_sent_per_trigger
  ON conversation_follow_ups (conversation_id, triggering_message_id)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS conversation_follow_ups_due_idx
  ON conversation_follow_ups (run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS conversation_follow_ups_account_idx
  ON conversation_follow_ups (account_id);

ALTER TABLE conversation_follow_ups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversation_follow_ups_select ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_select ON conversation_follow_ups
  FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS conversation_follow_ups_insert ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_insert ON conversation_follow_ups
  FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversation_follow_ups_update ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_update ON conversation_follow_ups
  FOR UPDATE
  USING (is_account_member(account_id, 'agent'))
  WITH CHECK (is_account_member(account_id, 'agent'));

DROP POLICY IF EXISTS conversation_follow_ups_delete ON conversation_follow_ups;
CREATE POLICY conversation_follow_ups_delete ON conversation_follow_ups
  FOR DELETE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_conversation_follow_ups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS conversation_follow_ups_updated_at ON conversation_follow_ups;
CREATE TRIGGER conversation_follow_ups_updated_at
  BEFORE UPDATE ON conversation_follow_ups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_conversation_follow_ups_updated_at();
