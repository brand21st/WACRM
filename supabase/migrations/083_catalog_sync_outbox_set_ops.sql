-- 082 added collection_id/payload but left the original op CHECK
-- (Postgres stores it as = ANY (ARRAY['upsert','delete'])).
-- Widen the check so set_upsert / set_delete can be written.

ALTER TABLE catalog_sync_outbox
  DROP CONSTRAINT IF EXISTS catalog_sync_outbox_op_check;

ALTER TABLE catalog_sync_outbox
  ADD CONSTRAINT catalog_sync_outbox_op_check
    CHECK (op IN ('upsert', 'delete', 'set_upsert', 'set_delete'));
