-- ============================================================
-- 069_commerce_receipt_email.sql
--
-- Optional Shopify receipt email between address confirmation
-- and the discount / bill step. Meta's India address form has
-- no email field, so we ask separately (Skip allowed).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS awaiting_email boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN whatsapp_commerce_orders.awaiting_email IS
  'Address confirmed; waiting for an optional receipt email or Skip before the discount/bill step.';

CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_awaiting_email_idx
  ON whatsapp_commerce_orders (conversation_id)
  WHERE awaiting_email;
