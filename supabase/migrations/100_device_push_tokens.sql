-- ============================================================
-- 100_device_push_tokens
--
-- Expo / FCM / APNs tokens so inbound WhatsApp messages can
-- wake a backgrounded or killed mobile client. One row per
-- install (unique expo_push_token). The user owns the row;
-- the webhook fan-out reads with the service role.
--
-- Idempotent — safe to re-run.
-- ============================================================
SET search_path TO public, extensions;

CREATE TABLE IF NOT EXISTS device_push_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expo_push_token text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_push_tokens_token_unique UNIQUE (expo_push_token)
);

COMMENT ON TABLE device_push_tokens IS
  'Expo push tokens for signed-in agents. Server fan-out on inbound customer messages.';

CREATE INDEX IF NOT EXISTS device_push_tokens_account_idx
  ON device_push_tokens (account_id);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
  ON device_push_tokens (user_id);

CREATE OR REPLACE FUNCTION public.update_device_push_tokens_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_push_tokens_updated_at ON device_push_tokens;
CREATE TRIGGER device_push_tokens_updated_at
  BEFORE UPDATE ON device_push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_device_push_tokens_updated_at();

ALTER TABLE device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS device_push_tokens_select ON device_push_tokens;
CREATE POLICY device_push_tokens_select ON device_push_tokens
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_account_member(account_id)
  );

DROP POLICY IF EXISTS device_push_tokens_insert ON device_push_tokens;
CREATE POLICY device_push_tokens_insert ON device_push_tokens
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_account_member(account_id)
  );

DROP POLICY IF EXISTS device_push_tokens_update ON device_push_tokens;
CREATE POLICY device_push_tokens_update ON device_push_tokens
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_account_member(account_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_account_member(account_id)
  );

DROP POLICY IF EXISTS device_push_tokens_delete ON device_push_tokens;
CREATE POLICY device_push_tokens_delete ON device_push_tokens
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND is_account_member(account_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON device_push_tokens TO authenticated;
