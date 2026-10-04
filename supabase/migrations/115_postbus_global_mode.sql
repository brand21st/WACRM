-- ============================================================
-- 115_postbus_global_mode.sql — platform/global PostBus sender
--
-- Adds an account-level routing mode. Merchant mode keeps the
-- existing 1:1 postbus_merchant_id check. Global mode uses one
-- template map for every PostBus organization UUID and treats
-- merchant_id as routing metadata, not a VaChat tenant boundary.
-- ============================================================

ALTER TABLE postbus_integrations
  ADD COLUMN IF NOT EXISTS routing_mode text NOT NULL DEFAULT 'merchant'
    CHECK (routing_mode IN ('merchant', 'global'));

COMMENT ON COLUMN postbus_integrations.routing_mode IS
  'merchant: API key maps to one PostBus org. global: dedicated sender for all PostBus orgs.';

COMMENT ON TABLE postbus_integrations IS
  'Per-account PostBus mapping. Global mode uses shared templates; merchant_id is optional routing metadata.';
