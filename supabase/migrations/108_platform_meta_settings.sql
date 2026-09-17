-- ============================================================
-- 108_platform_meta_settings.sql — platform Facebook Login
--
-- Singleton row for the Facebook app used by merchant
-- Settings → Instagram & Messenger → Connect. Super Admin APIs use
-- the service role after a TypeScript app_metadata check. Merchants
-- must not read or write these keys (per-account Page tokens stay on
-- meta_page_connections).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_meta_settings (
  id                         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  facebook_app_id            text,
  facebook_login_config_id   text,
  facebook_app_secret        text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_meta_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_meta_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE platform_meta_settings FROM PUBLIC;
REVOKE ALL ON TABLE platform_meta_settings FROM anon;
REVOKE ALL ON TABLE platform_meta_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE platform_meta_settings TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON platform_meta_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_meta_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE platform_meta_settings IS
  'Singleton Facebook Login app for Instagram & Messenger Connect. App secret encrypted at rest.';
