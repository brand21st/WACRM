-- ============================================================
-- 113_postbus_integrations.sql — per-account PostBus mapping
--
-- Settings → Integrations → PostBus (Phase 1). Stores merchant ↔
-- Vachat account mapping and encrypted API credentials. Does NOT
-- send WhatsApp messages or register Meta webhooks.
--
-- One row per account (same pattern as google_sheets_configs /
-- shopify_configs). A PostBus merchant id may be claimed by only
-- one Vachat account.
--
-- RLS: any member may read (so Settings can show status); admin+
-- may write. API keys are AES-256-GCM-encrypted in app code and
-- never selected into client responses.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS postbus_integrations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  created_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  postbus_merchant_id    text,
  api_base_url           text,
  api_key_encrypted      text,
  status                 text NOT NULL DEFAULT 'configuration_required'
                           CHECK (status IN (
                             'not_connected',
                             'connected',
                             'configuration_required',
                             'error'
                           )),
  notification_settings  jsonb NOT NULL DEFAULT '{
    "order_created": false,
    "shipment_created": false,
    "shipment_dispatched": false,
    "in_transit": false,
    "out_for_delivery": false,
    "delivered": false,
    "delivery_failed": false,
    "tracking_updated": false,
    "return_rto": false,
    "other": false
  }'::jsonb,
  connected_at           timestamptz,
  last_tested_at         timestamptz,
  last_test_result       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS postbus_integrations_merchant_id_key
  ON postbus_integrations (postbus_merchant_id)
  WHERE postbus_merchant_id IS NOT NULL;

ALTER TABLE postbus_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS postbus_integrations_select ON postbus_integrations;
CREATE POLICY postbus_integrations_select ON postbus_integrations FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS postbus_integrations_insert ON postbus_integrations;
CREATE POLICY postbus_integrations_insert ON postbus_integrations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS postbus_integrations_update ON postbus_integrations;
CREATE POLICY postbus_integrations_update ON postbus_integrations FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS postbus_integrations_delete ON postbus_integrations;
CREATE POLICY postbus_integrations_delete ON postbus_integrations FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_postbus_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postbus_integrations_updated_at ON postbus_integrations;
CREATE TRIGGER postbus_integrations_updated_at
  BEFORE UPDATE ON postbus_integrations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_postbus_integrations_updated_at();

COMMENT ON TABLE postbus_integrations IS
  'Per-account PostBus merchant mapping and encrypted credentials. Phase 1 config only.';
