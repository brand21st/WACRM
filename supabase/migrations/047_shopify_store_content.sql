-- ============================================================
-- 047_shopify_store_content.sql — policies, pages, product body
--
-- Local snapshot of Shopify shop policies (privacy, refund, shipping,
-- terms, etc.) and Online Store pages (About, Contact, FAQ, …) so the
-- WhatsApp AI can answer business questions from real store copy.
--
-- Also stores the full product description on catalog rows (body) while
-- keeping body_excerpt for card search.
--
-- Lexical FTS on title+body (same 'simple' config as ai_knowledge_chunks).
-- Policies have no reliable Shopify webhook — they refresh on bootstrap
-- and manual content sync. Pages use pages/create|update|delete.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE shopify_configs
  ADD COLUMN IF NOT EXISTS last_content_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_item_count integer NOT NULL DEFAULT 0
    CHECK (content_item_count >= 0);

ALTER TABLE shopify_catalog_products
  ADD COLUMN IF NOT EXISTS body text;

CREATE TABLE IF NOT EXISTS shopify_store_content (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  shopify_resource_id   text NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('policy', 'page')),
  handle                text,
  title                 text NOT NULL,
  body                  text NOT NULL DEFAULT '',
  page_url              text,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  fts                   tsvector GENERATED ALWAYS AS (
                          to_tsvector(
                            'simple',
                            coalesce(title, '') || ' ' || coalesce(body, '')
                          )
                        ) STORED,
  UNIQUE (account_id, shopify_resource_id)
);

CREATE INDEX IF NOT EXISTS shopify_store_content_account_kind_idx
  ON shopify_store_content (account_id, kind);

CREATE INDEX IF NOT EXISTS shopify_store_content_title_idx
  ON shopify_store_content (account_id, title);

CREATE INDEX IF NOT EXISTS shopify_store_content_fts_idx
  ON shopify_store_content USING gin (fts);

ALTER TABLE shopify_store_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shopify_store_content_select ON shopify_store_content;
CREATE POLICY shopify_store_content_select ON shopify_store_content FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS shopify_store_content_insert ON shopify_store_content;
CREATE POLICY shopify_store_content_insert ON shopify_store_content FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_store_content_update ON shopify_store_content;
CREATE POLICY shopify_store_content_update ON shopify_store_content FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS shopify_store_content_delete ON shopify_store_content;
CREATE POLICY shopify_store_content_delete ON shopify_store_content FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.match_shopify_store_content_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (
  id      uuid,
  kind    text,
  title   text,
  handle  text,
  body    text,
  page_url text,
  rank    real
) AS $$
  SELECT c.id,
         c.kind,
         c.title,
         c.handle,
         c.body,
         c.page_url,
         ts_rank(c.fts, plainto_tsquery('simple', p_query)) AS rank
  FROM shopify_store_content c
  WHERE c.account_id = p_account_id
    AND c.fts @@ plainto_tsquery('simple', p_query)
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_shopify_store_content_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_shopify_store_content_fts(uuid, text, integer) TO authenticated, service_role;
