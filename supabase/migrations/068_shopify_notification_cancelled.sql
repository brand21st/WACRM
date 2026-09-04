-- ============================================================
-- 068_shopify_notification_cancelled.sql
--
-- Order-lifecycle WhatsApp presets now include cancelled and
-- partially fulfilled. Widen the trigger_key CHECK so Settings
-- can persist those two rules.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE shopify_notification_rules
  DROP CONSTRAINT IF EXISTS shopify_notification_rules_trigger_key_check;

ALTER TABLE shopify_notification_rules
  ADD CONSTRAINT shopify_notification_rules_trigger_key_check
  CHECK (trigger_key IN (
    'new_order',
    'processing',
    'checkout_abandoned',
    'partially_fulfilled',
    'fulfilled',
    'tracking',
    'delivered',
    'after_delivered',
    'cancelled',
    'refund',
    'return_request'
  ));
