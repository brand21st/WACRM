import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings'
import {
  CATALOG_EMBEDDING_MODEL,
} from './embed-document'

export type CatalogHybridMode = 'off' | 'shadow' | 'on'

const QUERY_EMBED_TTL_MS = 15 * 60 * 1000
const QUERY_EMBED_CACHE_CAP = 200
const queryEmbedCache = new Map<string, { vector: number[]; exp: number }>()

export const SEMANTIC_CANDIDATE_CAP = 32

export async function loadCatalogHybridMode(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogHybridMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('catalog_hybrid_search')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !data) return 'off'
    const mode = (data as { catalog_hybrid_search?: string }).catalog_hybrid_search
    if (mode === 'shadow' || mode === 'on') return mode
    return 'off'
  } catch {
    return 'off'
  }
}

export async function countReadyCatalogEmbeddings(
  db: SupabaseClient,
  accountId: string,
): Promise<number> {
  const { count, error } = await db
    .from('catalog_product_embeddings')
    .select('product_id', { count: 'exact', head: true })
    .eq('account_id', accountId)
    .eq('model', CATALOG_EMBEDDING_MODEL)
    .in('status', ['ready', 'stale'])
  if (error || !count) return 0
  return count
}

export async function matchCatalogSemantic(
  db: SupabaseClient,
  accountId: string,
  query: string,
  embeddingsApiKey: string,
  limit = SEMANTIC_CANDIDATE_CAP,
): Promise<string[]> {
  const text = query.trim()
  if (!text) return []
  const vector = await embedQueryCached(embeddingsApiKey, text)
  if (!vector) return []
  const { data, error } = await db.rpc('match_catalog_products_semantic', {
    p_account_id: accountId,
    p_query_embedding: toVectorLiteral(vector),
    p_model: CATALOG_EMBEDDING_MODEL,
    p_match_count: Math.min(SEMANTIC_CANDIDATE_CAP, Math.max(1, limit)),
  })
  if (error || !Array.isArray(data)) return []
  return (data as { product_id?: string }[])
    .map((row) => String(row.product_id ?? ''))
    .filter(Boolean)
}

export async function semanticNeighborsForProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  embeddingsApiKey: string | null | undefined,
  limit = SEMANTIC_CANDIDATE_CAP,
): Promise<string[]> {
  if (!embeddingsApiKey) return []
  const { data, error } = await db
    .from('catalog_product_embeddings')
    .select('embedding')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .eq('model', CATALOG_EMBEDDING_MODEL)
    .in('status', ['ready', 'stale'])
    .maybeSingle()
  if (error || !data?.embedding) return []
  const { data: rows, error: rpcError } = await db.rpc('match_catalog_products_semantic', {
    p_account_id: accountId,
    p_query_embedding:
      typeof data.embedding === 'string'
        ? data.embedding
        : toVectorLiteral(data.embedding as number[]),
    p_model: CATALOG_EMBEDDING_MODEL,
    p_match_count: Math.min(SEMANTIC_CANDIDATE_CAP, Math.max(1, limit + 1)),
  })
  if (rpcError || !Array.isArray(rows)) return []
  return (rows as { product_id?: string }[])
    .map((row) => String(row.product_id ?? ''))
    .filter((id) => id && id !== productId)
}

export async function resolveCatalogEmbeddingsKey(
  db: SupabaseClient,
  accountId: string,
  override?: string | null,
): Promise<string | null> {
  if (override !== undefined) return override
  const { key } = await loadEmbeddingsKey(db, accountId)
  return key
}

async function embedQueryCached(
  apiKey: string,
  query: string,
): Promise<number[] | null> {
  const cacheKey = createHash('sha256')
    .update(`${CATALOG_EMBEDDING_MODEL}\n${query}`)
    .digest('hex')
  const now = Date.now()
  const hit = queryEmbedCache.get(cacheKey)
  if (hit && hit.exp > now) return hit.vector
  const [vector] = await embedTexts(apiKey, [query], CATALOG_EMBEDDING_MODEL)
  if (!vector) return null
  if (queryEmbedCache.size >= QUERY_EMBED_CACHE_CAP) {
    const first = queryEmbedCache.keys().next().value
    if (first) queryEmbedCache.delete(first)
  }
  queryEmbedCache.set(cacheKey, { vector, exp: now + QUERY_EMBED_TTL_MS })
  return vector
}
