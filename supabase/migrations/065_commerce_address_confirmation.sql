-- ============================================================
-- 065_commerce_address_confirmation.sql
--
-- Adds the address-confirmation step between collecting a
-- delivery address and sending the payable order_details bill.
--
-- The customer now sees the address we're about to ship to with
-- Confirm / Change buttons, and the bill goes out only after they
-- confirm. `awaiting_confirmation` is what the confirm tap claims
-- atomically, so a double tap cannot send two bills for one order.
--
-- Order lifecycle while status = 'pending':
--   awaiting_address = true                       -> waiting for the address
--   awaiting_confirmation = true                  -> waiting for the confirm tap
--   both false                                    -> bill sent, waiting for payment
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE whatsapp_commerce_orders
  ADD COLUMN IF NOT EXISTS awaiting_confirmation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN whatsapp_commerce_orders.awaiting_confirmation IS
  'Address collected and shown to the customer; the bill is sent once they tap Confirm.';

-- Confirm taps look the order up by (account_id, reference_id), which the
-- table''s UNIQUE constraint already covers. This partial index keeps the
-- "still waiting on a tap" scan cheap for conversation-scoped lookups.
CREATE INDEX IF NOT EXISTS whatsapp_commerce_orders_awaiting_confirmation_idx
  ON whatsapp_commerce_orders (conversation_id)
  WHERE awaiting_confirmation;
