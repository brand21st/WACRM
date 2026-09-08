-- Collection / product-set events reuse catalog_sync_outbox.
-- Product upsert/delete rows and items_batch behavior are unchanged.

ALTER TABLE catalog_sync_outbox
  ADD COLUMN IF NOT EXISTS collection_id uuid;

ALTER TABLE catalog_sync_outbox
  ADD COLUMN IF NOT EXISTS payload jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'catalog_sync_outbox_collection_id_fkey'
      AND conrelid = 'catalog_sync_outbox'::regclass
  ) THEN
    ALTER TABLE catalog_sync_outbox
      ADD CONSTRAINT catalog_sync_outbox_collection_id_fkey
        FOREIGN KEY (collection_id) REFERENCES catalog_collections(id)
        ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE catalog_sync_outbox
  DROP CONSTRAINT IF EXISTS catalog_sync_outbox_op_check;

ALTER TABLE catalog_sync_outbox
  ADD CONSTRAINT catalog_sync_outbox_op_check
    CHECK (op IN ('upsert', 'delete', 'set_upsert', 'set_delete'));
