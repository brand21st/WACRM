-- ============================================================
-- 080_catalog_product_sets.sql — Meta / WhatsApp product sets
--
-- Reuses catalog_collections as Product sets. Stores the Meta
-- product_set id so WACRM can update/delete the same set on Graph.
-- ============================================================

ALTER TABLE catalog_collections
  ADD COLUMN IF NOT EXISTS meta_product_set_id text;

CREATE UNIQUE INDEX IF NOT EXISTS catalog_collections_account_meta_set_uidx
  ON catalog_collections (account_id, meta_product_set_id)
  WHERE meta_product_set_id IS NOT NULL;

COMMENT ON COLUMN catalog_collections.meta_product_set_id IS
  'Meta Commerce product_set id. Null until the set is published to the WhatsApp catalog.';
