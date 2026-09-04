-- ============================================================
-- 067_commerce_discount_code.sql
--
-- Optional Shopify discount code between address confirmation
-- and the payable WhatsApp bill. The customer either sends a
-- code or taps Skip; we look the code up in Shopify, put the
-- rupee amount on Meta's order.discount so Razorpay charges the
-- reduced total, then replay the same code on orderCreate.
--
-- awaiting_discount is claimed atomically (same pattern as
-- awaiting_confirmation) so Skip + a typed code cannot send two
-- bills.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS awaiting_discount boolean NOT NULL DEFAULT false;

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS discount_code text;

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS discount_value integer NOT NULL DEFAULT 0;

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS discount_percent numeric;

COMMENT ON COLUMN whatsapp_commerce_orders.awaiting_discount IS
  'Address confirmed; waiting for a Shopify discount code or Skip before sending the bill.';

COMMENT ON COLUMN whatsapp_commerce_orders.discount_code IS
  'Shopify discount code applied to this WhatsApp bill, if any.';

COMMENT ON COLUMN whatsapp_commerce_orders.discount_value IS
  'Discount in paise subtracted from the WhatsApp order_details total.';

COMMENT ON COLUMN whatsapp_commerce_orders.discount_percent IS
  'Percentage deducted when the Shopify code is percent-off; null for fixed amounts.';

CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_awaiting_discount_idx
  ON whatsapp_commerce_orders (conversation_id)
  WHERE awaiting_discount;
