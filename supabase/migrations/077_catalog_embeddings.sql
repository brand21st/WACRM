-- ============================================================
-- 077_catalog_embeddings.sql — Phase 3C product vectors
--
-- Adds an account-scoped product embedding table and a hybrid-search
-- flag. Does NOT change catalog_products FTS, Meta outbox, knowledge
-- RAG (ai_knowledge_chunks), or Shopify tables.
--
-- Reuses pgvector from migration 030 (text-embedding-3-small, 1536).
-- Semantic match is SECURITY INVOKER + RLS (same fix as 032).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_configs
  ADD COLUMN IF NOT EXISTS catalog_hybrid_search text NOT NULL DEFAULT 'off';

ALTER TABLE ai_configs DROP CONSTRAINT IF EXISTS ai_configs_catalog_hybrid_search_check;
ALTER TABLE ai_configs
  ADD CONSTRAINT ai_configs_catalog_hybrid_search_check
  CHECK (catalog_hybrid_search IN ('off', 'shadow', 'on'));

COMMENT ON COLUMN ai_configs.catalog_hybrid_search IS
  'off = lexical catalog search only; shadow = compute hybrid and log, return lexical; on = return hybrid.';

CREATE TABLE IF NOT EXISTS catalog_product_embeddings (
  product_id    uuid PRIMARY KEY REFERENCES catalog_products(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  embedding     vector(1536),
  model         text NOT NULL,
  dimensions    integer NOT NULL DEFAULT 1536,
  content_hash  text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'ready', 'failed', 'stale')),
  error         text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_product_embeddings_account_status_model_idx
  ON catalog_product_embeddings (account_id, status, model);

CREATE INDEX IF NOT EXISTS catalog_product_embeddings_embedding_idx
  ON catalog_product_embeddings USING hnsw (embedding vector_cosine_ops);

ALTER TABLE catalog_product_embeddings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalog_product_embeddings_select ON catalog_product_embeddings;
CREATE POLICY catalog_product_embeddings_select ON catalog_product_embeddings
  FOR SELECT TO authenticated
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS catalog_product_embeddings_insert ON catalog_product_embeddings;
CREATE POLICY catalog_product_embeddings_insert ON catalog_product_embeddings
  FOR INSERT TO authenticated
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_product_embeddings_update ON catalog_product_embeddings;
CREATE POLICY catalog_product_embeddings_update ON catalog_product_embeddings
  FOR UPDATE TO authenticated
  USING (is_account_member(account_id, 'admin'))
  WITH CHECK (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS catalog_product_embeddings_delete ON catalog_product_embeddings;
CREATE POLICY catalog_product_embeddings_delete ON catalog_product_embeddings
  FOR DELETE TO authenticated
  USING (is_account_member(account_id, 'admin'));

DROP TRIGGER IF EXISTS catalog_product_embeddings_updated_at ON catalog_product_embeddings;
CREATE TRIGGER catalog_product_embeddings_updated_at
  BEFORE UPDATE ON catalog_product_embeddings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_updated_at();

CREATE OR REPLACE FUNCTION public.match_catalog_products_semantic(
  p_account_id      uuid,
  p_query_embedding text,
  p_model           text,
  p_match_count     integer
)
RETURNS TABLE (product_id uuid, distance real) AS $$
  SELECT e.product_id,
         (e.embedding <=> p_query_embedding::vector(1536)) AS distance
  FROM catalog_product_embeddings e
  INNER JOIN catalog_products p
    ON p.id = e.product_id
   AND p.account_id = e.account_id
  WHERE e.account_id = p_account_id
    AND p.account_id = p_account_id
    AND p.status = 'active'
    AND e.status IN ('ready', 'stale')
    AND e.model = p_model
    AND e.dimensions = 1536
    AND e.embedding IS NOT NULL
  ORDER BY e.embedding <=> p_query_embedding::vector(1536)
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_catalog_products_semantic(uuid, text, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_catalog_products_semantic(uuid, text, text, integer) TO authenticated, service_role;
