-- ============================================================
-- 114_postbus_phase2.sql — templates, live events, notification log
--
-- Aligns PostBus integration with PostBus's real WATI-equivalent
-- events and adds an idempotent send log. Does not change WhatsApp
-- send internals or Meta webhooks.
--
-- Safe if 113 has not been applied: creates postbus_integrations first.
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
    "order_confirmation": false,
    "processing": false,
    "booked": false,
    "in_transit": false,
    "delivered": false
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

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE postbus_integrations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE postbus_integrations TO service_role;

ALTER TABLE postbus_integrations
  ADD COLUMN IF NOT EXISTS order_confirmation_template_name text,
  ADD COLUMN IF NOT EXISTS processing_template_name text,
  ADD COLUMN IF NOT EXISTS booked_template_name text,
  ADD COLUMN IF NOT EXISTS in_transit_template_name text,
  ADD COLUMN IF NOT EXISTS delivered_template_name text,
  ADD COLUMN IF NOT EXISTS template_language text NOT NULL DEFAULT 'en_US',
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id uuid REFERENCES webhook_endpoints(id) ON DELETE SET NULL;

UPDATE postbus_integrations
SET notification_settings = jsonb_build_object(
  'order_confirmation', COALESCE((notification_settings->>'order_created')::boolean, false),
  'processing', false,
  'booked', COALESCE(
    (notification_settings->>'shipment_created')::boolean,
    (notification_settings->>'shipment_dispatched')::boolean,
    false
  ),
  'in_transit', COALESCE((notification_settings->>'in_transit')::boolean, false),
  'delivered', COALESCE((notification_settings->>'delivered')::boolean, false)
)
WHERE notification_settings IS NOT NULL;

ALTER TABLE postbus_integrations
  ALTER COLUMN notification_settings SET DEFAULT '{
    "order_confirmation": false,
    "processing": false,
    "booked": false,
    "in_transit": false,
    "delivered": false
  }'::jsonb;

CREATE TABLE IF NOT EXISTS postbus_notifications (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  merchant_id            text NOT NULL,
  external_ref           text NOT NULL,
  notification_type      text NOT NULL,
  to_phone               text NOT NULL,
  contact_id             uuid REFERENCES contacts(id) ON DELETE SET NULL,
  conversation_id        uuid REFERENCES conversations(id) ON DELETE SET NULL,
  message_id             uuid REFERENCES messages(id) ON DELETE SET NULL,
  whatsapp_message_id    text,
  status                 text NOT NULL DEFAULT 'sent'
                           CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_ref)
);

CREATE INDEX IF NOT EXISTS postbus_notifications_wamid_idx
  ON postbus_notifications (whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS postbus_notifications_message_idx
  ON postbus_notifications (message_id)
  WHERE message_id IS NOT NULL;

ALTER TABLE postbus_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS postbus_notifications_select ON postbus_notifications;
CREATE POLICY postbus_notifications_select ON postbus_notifications FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS postbus_notifications_insert ON postbus_notifications;
CREATE POLICY postbus_notifications_insert ON postbus_notifications FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS postbus_notifications_update ON postbus_notifications;
CREATE POLICY postbus_notifications_update ON postbus_notifications FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_postbus_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postbus_notifications_updated_at ON postbus_notifications;
CREATE TRIGGER postbus_notifications_updated_at
  BEFORE UPDATE ON postbus_notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_postbus_notifications_updated_at();

COMMENT ON TABLE postbus_notifications IS
  'Idempotent PostBus→WhatsApp send log. UNIQUE(account_id, external_ref).';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE postbus_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE postbus_notifications TO service_role;

COMMENT ON TABLE postbus_integrations IS
  'Per-account PostBus merchant mapping, template names, and notification toggles.';
