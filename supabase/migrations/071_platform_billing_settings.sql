-- ============================================================
-- 071_platform_billing_settings.sql — platform Razorpay keys
--
-- Singleton row for SaaS billing credentials. Super Admin APIs use
-- the service role after a TypeScript app_metadata check. Merchants
-- must not read or write these keys (WhatsApp catalog Razorpay lives
-- on shopify_configs).
-- ============================================================

CREATE TABLE IF NOT EXISTS platform_billing_settings (
  id                         smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  razorpay_key_id            text,
  razorpay_key_secret        text,
  razorpay_webhook_secret    text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_billing_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_billing_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE platform_billing_settings FROM PUBLIC;
REVOKE ALL ON TABLE platform_billing_settings FROM anon;
REVOKE ALL ON TABLE platform_billing_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE platform_billing_settings TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON platform_billing_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_billing_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
