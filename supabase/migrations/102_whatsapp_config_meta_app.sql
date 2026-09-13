-- Per-account Meta app credentials for bring-your-own-app tenants.
-- When a client uses their own Meta app (not the platform app), inbound
-- webhook POSTs are HMAC-signed with THAT app's secret. The global
-- META_APP_SECRET env var alone cannot verify those payloads.

ALTER TABLE whatsapp_config
  ADD COLUMN IF NOT EXISTS meta_app_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_app_secret TEXT;

COMMENT ON COLUMN whatsapp_config.meta_app_id IS
  'Meta developer app id for this tenant when they use their own app.';

COMMENT ON COLUMN whatsapp_config.meta_app_secret IS
  'AES-256-GCM encrypted App Secret for meta_app_id; used to verify inbound webhooks.';
