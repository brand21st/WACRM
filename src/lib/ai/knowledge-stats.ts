import { SHOPIFY_PRODUCT_KB_PREFIX } from '@/lib/shopify/product-knowledge-prefix'
import { SHOPIFY_KB_PREFIX } from '@/lib/shopify/store-content'

export type BreakdownKey =
  | 'shopify_products'
  | 'shopify_pages'
  | 'shopify_policies'
  | 'manual'
  | 'website'

export interface BreakdownBucket {
  key: BreakdownKey
  items: number
  indexed_items: number
  chunks: number
  characters: number
}

export interface KnowledgeStatsPayload {
  score: number
  total_chunks: number
  embedded_chunks: number
  total_indexed_chars: number
  has_embeddings_key: boolean
  embedding_coverage_pct: number
  breakdown: BreakdownBucket[]
}

const BREAKDOWN_KEYS: BreakdownKey[] = [
  'shopify_products',
  'shopify_pages',
  'shopify_policies',
  'manual',
  'website',
]

const CHAR_TARGET = 50_000
const CHUNK_TARGET = 50

export function emptyBreakdown(): BreakdownBucket[] {
  return BREAKDOWN_KEYS.map((key) => ({
    key,
    items: 0,
    indexed_items: 0,
    chunks: 0,
    characters: 0,
  }))
}

export function bucketIndex(
  buckets: BreakdownBucket[],
  key: BreakdownKey,
): BreakdownBucket {
  const row = buckets.find((b) => b.key === key)
  if (!row) throw new Error(`missing breakdown bucket: ${key}`)
  return row
}

export function classifyDocumentBucket(
  title: string,
  sourceType: string | null | undefined,
  storeKindByTitle?: Map<string, 'policy' | 'page'>,
): BreakdownKey {
  if (title.startsWith(SHOPIFY_PRODUCT_KB_PREFIX)) return 'shopify_products'
  if (title.startsWith(SHOPIFY_KB_PREFIX)) {
    const bare = title.slice(SHOPIFY_KB_PREFIX.length).trim()
    const kind = storeKindByTitle?.get(bare)
    if (kind === 'policy') return 'shopify_policies'
    if (kind === 'page') return 'shopify_pages'
    return 'shopify_pages'
  }
  if (sourceType === 'url') return 'website'
  return 'manual'
}

export function computeKnowledgeScore(input: {
  has_embeddings_key: boolean
  total_chunks: number
  embedded_chunks: number
  breakdown: BreakdownBucket[]
}): Pick<
  KnowledgeStatsPayload,
  'score' | 'total_indexed_chars' | 'embedding_coverage_pct'
> {
  const total_indexed_chars = input.breakdown.reduce(
    (sum, row) => sum + row.characters,
    0,
  )
  const volumeScore = Math.min(40, (total_indexed_chars / CHAR_TARGET) * 40)
  const breadthScore =
    input.breakdown.filter((row) => row.indexed_items > 0).length * 6
  const chunkCap = input.has_embeddings_key ? 20 : 30
  const chunkScore = Math.min(
    chunkCap,
    (input.total_chunks / CHUNK_TARGET) * chunkCap,
  )
  const embedding_coverage_pct =
    input.total_chunks > 0
      ? Math.round((input.embedded_chunks / input.total_chunks) * 100)
      : 0
  const embeddingScore =
    input.has_embeddings_key && input.total_chunks > 0
      ? (input.embedded_chunks / input.total_chunks) * 10
      : 0

  const score = Math.round(
    Math.min(100, volumeScore + breadthScore + chunkScore + embeddingScore),
  )

  return { score, total_indexed_chars, embedding_coverage_pct }
}

export function buildKnowledgeStatsPayload(input: {
  has_embeddings_key: boolean
  total_chunks: number
  embedded_chunks: number
  breakdown: BreakdownBucket[]
}): KnowledgeStatsPayload {
  const scored = computeKnowledgeScore(input)
  return {
    ...scored,
    total_chunks: input.total_chunks,
    embedded_chunks: input.embedded_chunks,
    has_embeddings_key: input.has_embeddings_key,
    breakdown: input.breakdown,
  }
}
