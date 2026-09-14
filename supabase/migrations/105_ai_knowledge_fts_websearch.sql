-- ============================================================
-- 105_ai_knowledge_fts_websearch.sql
--
-- Conversational questions ("Give your contact number", "do you
-- have COD") fail plainto_tsquery AND-matching. Switch lexical
-- retrieve to websearch_to_tsquery so the app can pass OR terms.
-- Also match hours/COD/return titles in the empty-FTS fallback.
-- ============================================================

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  tsq tsquery;
  lim integer := GREATEST(p_match_count, 0);
BEGIN
  IF lim <= 0 THEN
    RETURN;
  END IF;

  BEGIN
    tsq := websearch_to_tsquery('simple', nullif(btrim(p_query), ''));
  EXCEPTION WHEN others THEN
    tsq := NULL;
  END;

  IF tsq IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.content,
         ts_rank(c.fts, tsq) AS rank
  FROM ai_knowledge_chunks c
  WHERE c.account_id = p_account_id
    AND c.fts @@ tsq
  ORDER BY rank DESC
  LIMIT lim;
END;
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fallback(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  tsq tsquery;
  lim integer := GREATEST(p_match_count, 0);
BEGIN
  IF lim <= 0 THEN
    RETURN;
  END IF;

  BEGIN
    tsq := websearch_to_tsquery('simple', nullif(btrim(p_query), ''));
  EXCEPTION WHEN others THEN
    tsq := NULL;
  END;

  IF tsq IS NOT NULL THEN
    RETURN QUERY
    SELECT c.id,
           c.content,
           ts_rank(c.fts, tsq) AS rank
    FROM ai_knowledge_chunks c
    WHERE c.account_id = p_account_id
      AND c.fts @@ tsq
    ORDER BY rank DESC
    LIMIT lim;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.content,
         0::real AS rank
  FROM ai_knowledge_chunks c
  JOIN ai_knowledge_documents d ON d.id = c.document_id
  WHERE c.account_id = p_account_id
    AND (
      d.title ~* '(about|faq|contact|home|company|welcome|care|phone|whatsapp|support|helpline|hours|open|timing|cod|return|refund|custom)'
      OR COALESCE(d.source_url, '') ~* '(about|faq|contact|policy|care|phone|whatsapp|support|hours|shipping|return)'
    )
  ORDER BY d.updated_at DESC, c.chunk_index ASC
  LIMIT lim;
END;
$$;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fallback(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fallback(uuid, text, integer) TO authenticated, service_role;
