-- ============================================================
-- 072_account_hold_and_period_start.sql
-- Super Admin HOLD (dashboard lock) + subscription period start
-- ============================================================

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_status_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_status_check
  CHECK (status IN ('active', 'hold', 'suspended'));

ALTER TABLE account_subscriptions
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz;

UPDATE account_subscriptions
SET current_period_start = created_at
WHERE current_period_start IS NULL
  AND current_period_end IS NOT NULL;
