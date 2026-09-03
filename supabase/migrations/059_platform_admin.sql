-- ============================================================
-- 059_platform_admin.sql — platform operator columns + AI keys
--
-- Adds account-level suspend / AI kill-switch fields and a singleton
-- table for platform-hosted provider keys. Super Admin APIs use the
-- service role after a TypeScript app_metadata check; members must
-- not be able to flip status / ai_enabled via the existing
-- accounts_update RLS policy (that policy is row-level only).
-- ============================================================

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_status_check
  CHECK (status IN ('active', 'suspended'));

CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts (status);

-- RLS cannot restrict columns. Reject member writes to the platform
-- fields; the service-role JWT (and postgres itself) may change them.
CREATE OR REPLACE FUNCTION public.protect_account_platform_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.ai_enabled IS DISTINCT FROM OLD.ai_enabled THEN
    IF coalesce(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'account status and ai_enabled are platform-managed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_account_platform_columns ON accounts;
CREATE TRIGGER protect_account_platform_columns
  BEFORE UPDATE ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_account_platform_columns();

-- Merchant configs no longer store provider keys (platform owns them).
ALTER TABLE ai_configs
  ALTER COLUMN api_key DROP NOT NULL;

CREATE TABLE IF NOT EXISTS platform_ai_settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  openai_api_key        text,
  anthropic_api_key     text,
  embeddings_api_key    text,
  elevenlabs_api_key    text,
  sarvam_api_key        text,
  chat_provider         text NOT NULL DEFAULT 'openai'
                          CHECK (chat_provider IN ('openai', 'anthropic')),
  chat_model            text NOT NULL DEFAULT 'gpt-5.4-mini',
  voice_provider        text NOT NULL DEFAULT 'elevenlabs'
                          CHECK (voice_provider IN ('elevenlabs', 'sarvam')),
  global_ai_enabled     boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_ai_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE platform_ai_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE platform_ai_settings FROM PUBLIC;
REVOKE ALL ON TABLE platform_ai_settings FROM anon;
REVOKE ALL ON TABLE platform_ai_settings FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE platform_ai_settings TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON platform_ai_settings;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON platform_ai_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
