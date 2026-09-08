import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueCatalogEmbed } from '@/lib/queue/enqueue'
import { attachCatalogFacts } from '../intelligence/facts'
import { getProductById } from '../core/repository'
import {
  CATALOG_EMBEDDING_DIMENSIONS,
  CATALOG_EMBEDDING_MODEL,
  buildCatalogEmbedDocument,
  hashCatalogEmbedDocument,
} from '../search/embed-document'

export async function scheduleCatalogEmbed(
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
    .select('content_hash, status')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .maybeSingle()

  if (
    existing &&
    existing.content_hash === contentHash &&
    existing.status === 'ready'
  ) {
    return
  }

  const nextStatus = existing?.status === 'ready' ? 'stale' : 'pending'
  const { error } = await db.from('catalog_product_embeddings').upsert(
    {
      product_id: productId,
      account_id: accountId,
      content_hash: contentHash,
      status: nextStatus,
      model: CATALOG_EMBEDDING_MODEL,
      dimensions: CATALOG_EMBEDDING_DIMENSIONS,
      error: null,
    },
    { onConflict: 'product_id' },
  )
  if (error) {
    console.warn('[catalog-embed] mark stale failed', { accountId, productId, error: error.message })
  }

  const queued = await enqueueCatalogEmbed({ accountId, productId })
  if (!queued) {
    console.warn('[catalog-embed] enqueue skipped', { accountId, productId })
  }
}
