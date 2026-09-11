-- ============================================================
-- 097 — Attach Phase 7 assignment attribution to sales_events
--
-- 096 deferred this FK until sales_events existed. After 092,
-- add the same constraint. Idempotent.
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public.sales_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'ai_behavior_assignments_attributed_event_id_fkey'
     )
  THEN
    ALTER TABLE ai_behavior_assignments
      ADD CONSTRAINT ai_behavior_assignments_attributed_event_id_fkey
      FOREIGN KEY (attributed_event_id) REFERENCES sales_events(id)
      ON DELETE SET NULL;
  END IF;
END
$$;
