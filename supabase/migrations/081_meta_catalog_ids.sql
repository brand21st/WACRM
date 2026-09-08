-- ============================================================
-- 081_meta_catalog_ids.sql — multiple WhatsApp catalog destinations
--
-- meta_catalog_id stays the primary catalog (checkout, shopping).
-- meta_catalog_ids lists every selected sync destination.
-- ============================================================

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS meta_catalog_ids text[] NOT NULL DEFAULT '{}';

UPDATE shopify_configs
SET meta_catalog_ids = ARRAY[meta_catalog_id]
WHERE meta_catalog_id IS NOT NULL
  AND btrim(meta_catalog_id) <> ''
  AND cardinality(meta_catalog_ids) = 0;

COMMENT ON COLUMN shopify_configs.meta_catalog_ids IS
  'Selected WhatsApp / Meta Commerce catalog IDs to publish products and sets to. meta_catalog_id is the primary catalog for checkout.';
