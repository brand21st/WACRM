-- ============================================================
-- 048_shopify_order_notifications.sql
--
-- Per-account WhatsApp template rules for Shopify order-lifecycle
-- events (new order, abandoned checkout, fulfilled, tracking,
-- delivered, refund, return request, etc.). Delayed sends
-- (abandoned checkout wait, N days after delivered) live in
-- shopify_notification_jobs; shopify_notification_sends blocks
-- duplicate Meta sends when Shopify retries a webhook.
--
-- RLS: any member may read (Settings + inbox context); admin+ may
-- write. Webhook and cron use the service-role client.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS shopify_notification_rules (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger_key         text NOT NULL
                        CHECK (trigger_key IN (
                          'new_order',
                          'processing',
                          'checkout_abandoned',
                          'fulfilled',
                          'tracking',
                          'delivered',
                          'after_delivered',
                          'refund',
                          'return_request'
                        )),
  is_enabled          boolean NOT NULL DEFAULT false,
  template_name       text,
  template_language   text NOT NULL DEFAULT 'en_US',
  variable_map        jsonb NOT NULL DEFAULT '{}'::jsonb,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, trigger_key)
);

CREATE INDEX IF NOT EXISTS shopify_notification_rules_account_idx
  ON shopify_notification_rules (account_id);

ALTER TABLE shopify_notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_notification_rules_select ON shopify_notification_rules;
CREATE POLICY shopify_notification_rules_select ON shopify_notification_rules FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_notification_rules_insert ON shopify_notification_rules;
CREATE POLICY shopify_notification_rules_insert ON shopify_notification_rules FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_notification_rules_update ON shopify_notification_rules;
CREATE POLICY shopify_notification_rules_update ON shopify_notification_rules FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_notification_rules_delete ON shopify_notification_rules;
CREATE POLICY shopify_notification_rules_delete ON shopify_notification_rules FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_shopify_notification_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS shopify_notification_rules_updated_at ON shopify_notification_rules;
CREATE TRIGGER shopify_notification_rules_updated_at
  BEFORE UPDATE ON shopify_notification_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_shopify_notification_rules_updated_at();

CREATE TABLE IF NOT EXISTS shopify_notification_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger_key         text NOT NULL,
  resource_id         text NOT NULL,
  run_at              timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN (
                          'pending',
                          'running',
                          'cancelled',
                          'sent',
                          'failed'
                        )),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, trigger_key, resource_id)
);

CREATE INDEX IF NOT EXISTS shopify_notification_jobs_due_idx
  ON shopify_notification_jobs (run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS shopify_notification_jobs_account_idx
  ON shopify_notification_jobs (account_id, status);

ALTER TABLE shopify_notification_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_notification_jobs_select ON shopify_notification_jobs;
CREATE POLICY shopify_notification_jobs_select ON shopify_notification_jobs FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_notification_jobs_insert ON shopify_notification_jobs;
CREATE POLICY shopify_notification_jobs_insert ON shopify_notification_jobs FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_notification_jobs_update ON shopify_notification_jobs;
CREATE POLICY shopify_notification_jobs_update ON shopify_notification_jobs FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_notification_jobs_delete ON shopify_notification_jobs;
CREATE POLICY shopify_notification_jobs_delete ON shopify_notification_jobs FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE TABLE IF NOT EXISTS shopify_notification_sends (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  trigger_key         text NOT NULL,
  resource_id         text NOT NULL,
  conversation_id     uuid,
  template_name       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, trigger_key, resource_id)
);

CREATE INDEX IF NOT EXISTS shopify_notification_sends_account_idx
  ON shopify_notification_sends (account_id, created_at DESC);

ALTER TABLE shopify_notification_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_notification_sends_select ON shopify_notification_sends;
CREATE POLICY shopify_notification_sends_select ON shopify_notification_sends FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_notification_sends_insert ON shopify_notification_sends;
CREATE POLICY shopify_notification_sends_insert ON shopify_notification_sends FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_notification_sends_delete ON shopify_notification_sends;
CREATE POLICY shopify_notification_sends_delete ON shopify_notification_sends FOR DELETE
  USING (is_account_member(account_id, 'admin'));
