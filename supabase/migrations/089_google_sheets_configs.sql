-- ============================================================
-- 089_google_sheets_configs.sql — per-account Google Sheets OAuth
--
-- One Google Sheets connection per workspace (same pattern as
-- `shopify_configs` / `whatsapp_config`). Access and refresh tokens
-- are stored AES-256-GCM-encrypted and never returned to the client.
--
-- Spreadsheet id/name and last_synced_at are reserved for a later
-- import/export feature; this migration only supports connect/status/
-- disconnect.
--
-- RLS: any member may read (so Settings can show status); admin+ may
-- write. The OAuth callback uses the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS google_sheets_configs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  google_email       text,
  google_account_id  text,
  access_token       text NOT NULL,
  refresh_token      text NOT NULL,
  token_expires_at   timestamptz,
  scopes             text[] NOT NULL DEFAULT '{}',
  spreadsheet_id     text,
  spreadsheet_name   text,
  last_synced_at     timestamptz,
  status             text NOT NULL DEFAULT 'connected'
                       CHECK (status IN ('connected', 'needs_reconnect')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE google_sheets_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS google_sheets_configs_select ON google_sheets_configs;
CREATE POLICY google_sheets_configs_select ON google_sheets_configs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS google_sheets_configs_insert ON google_sheets_configs;
CREATE POLICY google_sheets_configs_insert ON google_sheets_configs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_sheets_configs_update ON google_sheets_configs;
CREATE POLICY google_sheets_configs_update ON google_sheets_configs FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS google_sheets_configs_delete ON google_sheets_configs;
CREATE POLICY google_sheets_configs_delete ON google_sheets_configs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_google_sheets_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS google_sheets_configs_updated_at ON google_sheets_configs;
CREATE TRIGGER google_sheets_configs_updated_at
  BEFORE UPDATE ON google_sheets_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_google_sheets_configs_updated_at();
