import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import {
  bucketIndex,
  buildKnowledgeStatsPayload,
  classifyDocumentBucket,
  emptyBreakdown,
  type BreakdownKey,
} from '@/lib/ai/knowledge-stats'

const LIST_PAGE_SIZE = 1000

async function listAllRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + LIST_PAGE_SIZE - 1)
    if (error) return { rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < LIST_PAGE_SIZE) break
  }
  return { rows, error: null }
}

function addIndexed(
  bucket: { items: number; indexed_items: number; characters: number },
  text: string | null | undefined,
) {
  bucket.items += 1
  const body = String(text ?? '').trim()
  if (!body) return
  bucket.indexed_items += 1
  bucket.characters += body.length
}

/**
 * GET /api/ai/knowledge/stats
 *
 * Coverage score + per-source breakdown for the Knowledge settings panel.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { key: embeddingsKey } = await loadEmbeddingsKey(supabase, accountId)
    const has_embeddings_key = Boolean(embeddingsKey)

    const breakdown = emptyBreakdown()
    const storeKindByTitle = new Map<string, 'policy' | 'page'>()
    const docBucketById = new Map<string, BreakdownKey>()

    const [storeRes, catalogRes, docsRes, chunksRes] = await Promise.all([
      listAllRows<{ kind: string; title: string; body: string | null }>(
        (from, to) =>
          supabase
            .from('shopify_store_content')
            .select('kind, title, body')
            .eq('account_id', accountId)
            .range(from, to),
      ),
      listAllRows<{
        title: string | null
        body: string | null
        body_excerpt: string | null
      }>((from, to) =>
        supabase
          .from('shopify_catalog_products')
          .select('title, body, body_excerpt')
          .eq('account_id', accountId)
          .range(from, to),
      ),
      listAllRows<{
        id: string
        title: string
        content: string
        source_type: string | null
      }>((from, to) =>
        supabase
          .from('ai_knowledge_documents')
          .select('id, title, content, source_type')
          .eq('account_id', accountId)
          .range(from, to),
      ),
      listAllRows<{ document_id: string; embedding: unknown }>((from, to) =>
        supabase
          .from('ai_knowledge_chunks')
          .select('document_id, embedding')
          .eq('account_id', accountId)
          .range(from, to),
      ),
    ])

    for (const row of storeRes.rows) {
      const title = String(row.title ?? '').trim()
      if (title) {
        storeKindByTitle.set(title, row.kind === 'policy' ? 'policy' : 'page')
      }
      const key: BreakdownKey =
        row.kind === 'policy' ? 'shopify_policies' : 'shopify_pages'
      addIndexed(bucketIndex(breakdown, key), row.body)
    }

    for (const row of catalogRes.rows) {
      const body = String(row.body || row.body_excerpt || '')
      addIndexed(bucketIndex(breakdown, 'shopify_products'), body)
    }

    for (const doc of docsRes.rows) {
      const bucket = classifyDocumentBucket(
        doc.title,
        doc.source_type,
        storeKindByTitle,
      )
      docBucketById.set(doc.id, bucket)
      if (bucket === 'manual' || bucket === 'website') {
        addIndexed(bucketIndex(breakdown, bucket), doc.content)
      }
    }

    let embedded_chunks = 0
    for (const chunk of chunksRes.rows) {
      const bucket = docBucketById.get(chunk.document_id)
      if (bucket) bucketIndex(breakdown, bucket).chunks += 1
      if (chunk.embedding != null) embedded_chunks += 1
    }

    const total_chunks = chunksRes.rows.length

    const payload = buildKnowledgeStatsPayload({
      has_embeddings_key,
      total_chunks,
      embedded_chunks,
      breakdown,
    })

    return NextResponse.json(payload)
  } catch (err) {
    return toErrorResponse(err)
  }
}
