-- ============================================================
-- 090_platform_google_settings.sql — platform Google OAuth app
--
-- Singleton row for the Google Cloud OAuth Web client used by
-- Settings → Integrations → Google Sheets. Super Admin APIs use the
-- service role after a TypeScript app_metadata check. Merchants must
-- not read or write these keys (per-account tokens stay on
-- google_sheets_configs).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_google_settings (
  id                     smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  google_client_id       text,
  google_client_secret   text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_google_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_google_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE platform_google_settings FROM PUBLIC;
REVOKE ALL ON TABLE platform_google_settings FROM anon;
REVOKE ALL ON TABLE platform_google_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE platform_google_settings TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON platform_google_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_google_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
