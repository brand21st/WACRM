-- ============================================================
-- 050_broadcast_schedule
--
-- Dashboard broadcasts can be scheduled for a future `scheduled_at`
-- (column + status already exist from 001). Two gaps blocked that:
--
--   1. header_media_url — the wizard collects a media-header override
--      in the personalize step, but it lived only in the browser
--      session. A cron drain (or a resume) would fall back to the
--      template sample URL. Persist the override on the parent row.
--
--   2. idx_broadcasts_due_scheduled — the drain selects
--      `status = 'scheduled' AND scheduled_at <= now()`. A partial
--      index on scheduled_at matching that filter keeps the scan off
--      sent/draft/failed rows.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS header_media_url TEXT;

COMMENT ON COLUMN broadcasts.header_media_url IS
  'Optional IMAGE/VIDEO/DOCUMENT header override for this campaign. Frozen at plan time so a later cron drain or resume sends the same media the wizard previewed.';

CREATE INDEX IF NOT EXISTS idx_broadcasts_due_scheduled
  ON broadcasts (scheduled_at)
  WHERE status = 'scheduled';
