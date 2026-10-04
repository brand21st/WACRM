-- ============================================================
-- 112_shopify_product_card_button.sql
-- WhatsApp product-card CTA: checkout permalink vs product page.
-- ============================================================

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS product_card_button text NOT NULL DEFAULT 'checkout';

ALTER TABLE shopify_configs
  DROP CONSTRAINT IF EXISTS shopify_configs_product_card_button_check;

ALTER TABLE shopify_configs
  ADD CONSTRAINT shopify_configs_product_card_button_check
  CHECK (product_card_button IN ('checkout', 'product'));

COMMENT ON COLUMN shopify_configs.product_card_button IS
  'WhatsApp product-card button: checkout permalink (Checkout NOW) or product page (View product).';
