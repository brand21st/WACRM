-- ============================================================
-- 091_quick_reply_media.sql
--
-- Quick replies can be a saved image / video / document (plus an
-- optional caption in content_text), not only plain text or a saved
-- interactive payload. Media lives in the existing chat-media bucket;
-- these columns store the public URL, storage path (for GC), and the
-- original filename (documents).
-- ============================================================

SET search_path TO public, extensions;

ALTER TABLE quick_replies
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_path TEXT,
  ADD COLUMN IF NOT EXISTS media_filename TEXT;

ALTER TABLE quick_replies DROP CONSTRAINT IF EXISTS quick_replies_kind_check;

ALTER TABLE quick_replies
  ADD CONSTRAINT quick_replies_kind_check
  CHECK (kind IN ('text', 'interactive', 'image', 'video', 'document'));
