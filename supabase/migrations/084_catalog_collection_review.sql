-- WhatsApp Catalogue hides collections until Meta live_metadata passes review.
ALTER TABLE catalog_collections
  ADD COLUMN IF NOT EXISTS meta_collection_review text;

ALTER TABLE catalog_collections
  DROP CONSTRAINT IF EXISTS catalog_collections_meta_review_check;

ALTER TABLE catalog_collections
  ADD CONSTRAINT catalog_collections_meta_review_check
  CHECK (
    meta_collection_review IS NULL
    OR meta_collection_review IN ('pending', 'live')
  );

COMMENT ON COLUMN catalog_collections.meta_collection_review IS
  'WhatsApp Catalogue collection review: pending (latest_metadata only) or live.';
