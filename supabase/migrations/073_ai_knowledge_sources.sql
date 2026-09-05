-- ============================================================
-- 073_ai_knowledge_sources.sql — URL scrape metadata + jobs
--
-- Knowledge documents can now come from a pasted website URL as
-- well as manual paste. Re-scraping the same URL updates the
-- existing row (partial unique on account_id + source_url).
--
-- Site crawls persist progress in ai_knowledge_scrape_jobs so the
-- Settings UI can poll while remaining pages finish in a worker
-- or after() callback.
--
-- RLS mirrors 030: any member may read; only admin+ may change.
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual';

ALTER TABLE ai_knowledge_documents
  DROP CONSTRAINT IF EXISTS ai_knowledge_documents_source_type_check;
ALTER TABLE ai_knowledge_documents
  ADD CONSTRAINT ai_knowledge_documents_source_type_check
  CHECK (source_type IN ('manual', 'url'));

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS last_scraped_at timestamptz;

ALTER TABLE ai_knowledge_documents
  ADD COLUMN IF NOT EXISTS scrape_error text;

CREATE UNIQUE INDEX IF NOT EXISTS ai_knowledge_documents_account_source_url_uidx
  ON ai_knowledge_documents (account_id, source_url)
  WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_knowledge_scrape_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  start_url     text NOT NULL,
  mode          text NOT NULL CHECK (mode IN ('page', 'site')),
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done', 'failed')),
  pages_found   integer NOT NULL DEFAULT 0,
  pages_saved   integer NOT NULL DEFAULT 0,
  pages_failed  integer NOT NULL DEFAULT 0,
  error         text,
  pending_urls  jsonb NOT NULL DEFAULT '[]'::jsonb,
  visited_urls  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_knowledge_scrape_jobs_account_status_idx
  ON ai_knowledge_scrape_jobs (account_id, status);

ALTER TABLE ai_knowledge_scrape_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_knowledge_scrape_jobs_select ON ai_knowledge_scrape_jobs;
CREATE POLICY ai_knowledge_scrape_jobs_select ON ai_knowledge_scrape_jobs
  FOR SELECT USING (is_account_member(account_id));

DROP POLICY IF EXISTS ai_knowledge_scrape_jobs_insert ON ai_knowledge_scrape_jobs;
CREATE POLICY ai_knowledge_scrape_jobs_insert ON ai_knowledge_scrape_jobs
  FOR INSERT WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_scrape_jobs_update ON ai_knowledge_scrape_jobs;
CREATE POLICY ai_knowledge_scrape_jobs_update ON ai_knowledge_scrape_jobs
  FOR UPDATE
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS ai_knowledge_scrape_jobs_delete ON ai_knowledge_scrape_jobs;
CREATE POLICY ai_knowledge_scrape_jobs_delete ON ai_knowledge_scrape_jobs
  FOR DELETE USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS ai_knowledge_scrape_jobs_updated_at ON ai_knowledge_scrape_jobs;
CREATE TRIGGER ai_knowledge_scrape_jobs_updated_at
  BEFORE UPDATE ON ai_knowledge_scrape_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
