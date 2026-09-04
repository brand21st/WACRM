-- ============================================================
-- 070_contact_paid_labels.sql
--
-- Persist first-paid timestamps on contacts so the Inbox can
-- show WhatsApp Paid / Shopify Paid labels without joining
-- the commerce ledger on every list load.
--
-- wa_commerce_paid_at  — WhatsApp catalog payment captured
-- shopify_paid_at      — Shopify store checkout (orders/paid)
--                        that is not a WhatsApp-commerce order
--
-- Write-once (app sets only when NULL). Not cleared on refund.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS wa_commerce_paid_at timestamptz;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS shopify_paid_at timestamptz;

COMMENT ON COLUMN contacts.wa_commerce_paid_at IS
  'First WhatsApp catalog payment captured for this contact. Write-once; not cleared on refund.';

COMMENT ON COLUMN contacts.shopify_paid_at IS
  'First Shopify store checkout payment (orders/paid) that is not a WhatsApp-commerce order. Write-once.';

UPDATE contacts c
SET wa_commerce_paid_at = o.first_paid_at
FROM (
  SELECT contact_id, MIN(updated_at) AS first_paid_at
  FROM whatsapp_commerce_orders
  WHERE status IN ('processing', 'partially_shipped', 'shipped', 'completed')
    AND contact_id IS NOT NULL
  GROUP BY contact_id
) o
WHERE c.id = o.contact_id
  AND c.wa_commerce_paid_at IS NULL;
