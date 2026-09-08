import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings'
import { attachCatalogFacts } from '../intelligence/facts'
import { getProductById } from '../core/repository'
import {
  CATALOG_EMBEDDING_DIMENSIONS,
  CATALOG_EMBEDDING_MODEL,
  buildCatalogEmbedDocument,
  hashCatalogEmbedDocument,
} from '../search/embed-document'

export async function generateCatalogProductEmbedding(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  shopName?: string | null,
): Promise<void> {
  const product = await getProductById(db, accountId, productId)
  if (!product) return
  const [withFacts] = await attachCatalogFacts(db, accountId, [product])
  const document = buildCatalogEmbedDocument(withFacts ?? product, shopName)
  const contentHash = hashCatalogEmbedDocument(document)

  const { data: existing } = await db
    .from('catalog_product_embeddings')
    .select('content_hash, status, model')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .maybeSingle()

  if (
    existing?.status === 'ready' &&
    existing.content_hash === contentHash &&
    existing.model === CATALOG_EMBEDDING_MODEL
  ) {
    return
  }

  await db.from('catalog_product_embeddings').upsert(
    {
      product_id: productId,
      account_id: accountId,
      content_hash: contentHash,
      status: 'processing',
      model: CATALOG_EMBEDDING_MODEL,
      dimensions: CATALOG_EMBEDDING_DIMENSIONS,
      error: null,
    },
    { onConflict: 'product_id' },
  )

  const { key } = await loadEmbeddingsKey(db, accountId)
  if (!key) {
    await markFailed(db, accountId, productId, contentHash, 'No embeddings key')
    return
  }

  try {
    const [vector] = await embedTexts(key, [document], CATALOG_EMBEDDING_MODEL)
    if (!vector) throw new Error('Empty embedding')
    const { error } = await db.from('catalog_product_embeddings').upsert(
      {
        product_id: productId,
        account_id: accountId,
        embedding: toVectorLiteral(vector),
        model: CATALOG_EMBEDDING_MODEL,
        dimensions: CATALOG_EMBEDDING_DIMENSIONS,
        content_hash: contentHash,
        status: 'ready',
        error: null,
      },
      { onConflict: 'product_id' },
    )
    if (error) throw error
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await markFailed(db, accountId, productId, contentHash, message)
    throw err
  }
}

async function markFailed(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  contentHash: string,
  error: string,
): Promise<void> {
  await db.from('catalog_product_embeddings').upsert(
    {
      product_id: productId,
      account_id: accountId,
      content_hash: contentHash,
      status: 'failed',
      model: CATALOG_EMBEDDING_MODEL,
      dimensions: CATALOG_EMBEDDING_DIMENSIONS,
      error,
    },
    { onConflict: 'product_id' },
  )
}
