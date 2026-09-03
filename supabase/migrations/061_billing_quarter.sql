-- 061_billing_quarter.sql — 3-month (quarter) package interval

ALTER TABLE billing_packages
  DROP CONSTRAINT IF EXISTS billing_packages_interval_check;

ALTER TABLE billing_packages
  ADD CONSTRAINT billing_packages_interval_check
  CHECK (interval IN ('month', 'quarter', 'year'));
