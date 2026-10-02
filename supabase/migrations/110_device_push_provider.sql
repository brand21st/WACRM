-- ============================================================
-- 110_device_push_provider
--
-- Flutter registers FCM tokens; Expo still stores Expo push tokens.
-- provider defaults to 'expo' so existing rows keep working.
-- Idempotent.
-- ============================================================
SET search_path TO public, extensions;

ALTER TABLE device_push_tokens
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'expo';

ALTER TABLE device_push_tokens
  DROP CONSTRAINT IF EXISTS device_push_tokens_provider_check;

ALTER TABLE device_push_tokens
  ADD CONSTRAINT device_push_tokens_provider_check
  CHECK (provider IN ('expo', 'fcm'));

COMMENT ON COLUMN device_push_tokens.provider IS
  'expo = ExponentPushToken via Expo; fcm = Firebase registration token.';

COMMENT ON TABLE device_push_tokens IS
  'Device push tokens for signed-in agents (Expo or FCM). Webhook fan-out on inbound customer messages.';
