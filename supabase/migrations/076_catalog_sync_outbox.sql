-- ============================================================
-- Phase 2: production catalog_sync_outbox for Meta Commerce.
--
-- 075 shipped a stub: product_id ON DELETE CASCADE (delete events
-- vanished with the product) and no retailer_id snapshot, coalesce
-- key, or claim timestamp. This migration upgrades the existing
-- table in place. RLS/grants from 075 are unchanged.
--
-- Does not touch shopify_catalog_products.
-- Does not add embeddings.
-- ============================================================

ALTER TABLE catalog_sync_outbox
  ADD COLUMN IF NOT EXISTS retailer_ids text[] NOT NULL DEFAULT '{}';

ALTER TABLE catalog_sync_outbox
  ADD COLUMN IF NOT EXISTS coalesce_key text;

ALTER TABLE catalog_sync_outbox
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

UPDATE catalog_sync_outbox
SET coalesce_key = op || ':' || coalesce(product_id::text, id::text)
WHERE coalesce_key IS NULL OR btrim(coalesce_key) = '';

ALTER TABLE catalog_sync_outbox
  ALTER COLUMN coalesce_key SET NOT NULL;

-- Delete events must survive local product deletion.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_sync_outbox_product_id_fkey'
      AND conrelid = 'catalog_sync_outbox'::regclass
  ) THEN
    ALTER TABLE catalog_sync_outbox
      DROP CONSTRAINT catalog_sync_outbox_product_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_sync_outbox_product_id_fkey'
      AND conrelid = 'catalog_sync_outbox'::regclass
  ) THEN
    ALTER TABLE catalog_sync_outbox
      ADD CONSTRAINT catalog_sync_outbox_product_id_fkey
        FOREIGN KEY (product_id) REFERENCES catalog_products(id)
        ON DELETE SET NULL;
  END IF;
END $$;

-- Rapid pending updates reuse one row. Processing rows are left
-- alone so a mid-flight worker is not overwritten.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_sync_outbox_pending_coalesce_idx
  ON catalog_sync_outbox (account_id, coalesce_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS catalog_sync_outbox_processing_claimed_idx
  ON catalog_sync_outbox (account_id, claimed_at)
  WHERE status = 'processing';
