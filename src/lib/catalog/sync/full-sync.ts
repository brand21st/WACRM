import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueCatalogMetaSync } from '@/lib/queue/enqueue'
import {
  enqueueCatalogProductUpsert,
  enqueueCatalogSetUpsert,
  FULL_SYNC_INLINE_BUDGET,
} from './outbox'
import { listCollectionsByAccount } from '@/lib/catalog/core/repository'

const PAGE_SIZE = 100

/**
 * Enqueue coalesced Meta upserts for every active WACRM catalog product.
 * Does not call Meta Graph. Does not wipe Meta. Safe to run repeatedly.
 *
 * `queued` is the number of products that received an outbox event.
 */
export async function enqueueFullCatalogMetaSync(
  db: SupabaseClient,
  accountId: string,
): Promise<{ queued: number }> {
  let offset = 0
  let queued = 0
  const dispatchIds: string[] = []
  let redisOk = true

  for (;;) {
    const { data, error } = await db
      .from('catalog_products')
      .select('id')
      .eq('account_id', accountId)
      .eq('status', 'active')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) throw error
    const rows = data ?? []
    if (rows.length === 0) break

    const productIds = rows.map((row) => String(row.id))
    const retailerByProduct = await loadRetailerIdsByProduct(
      db,
      accountId,
      productIds,
    )

    for (const productId of productIds) {
      const retailerIds = retailerByProduct.get(productId) ?? []
      if (retailerIds.length === 0) continue
      const outboxId = await enqueueCatalogProductUpsert(
        db,
        accountId,
        productId,
        retailerIds,
        {
          ignoreAutoSync: true,
          dispatch: false,
          inlineFallback: false,
        },
      )
      if (!outboxId) continue
      queued += 1
      dispatchIds.push(outboxId)
    }

    offset += rows.length
    if (rows.length < PAGE_SIZE) break
  }

  for (const outboxId of dispatchIds) {
    if (!redisOk) break
    const ok = await enqueueCatalogMetaSync({ accountId, outboxId })
    if (!ok) redisOk = false
  }

  if (!redisOk) {
    const { processCatalogMetaSync } = await import(
      '@/lib/queue/processors/catalog-meta-sync'
    )
    for (const outboxId of dispatchIds.slice(0, FULL_SYNC_INLINE_BUDGET)) {
      try {
        await processCatalogMetaSync({ accountId, outboxId })
      } catch (err) {
        console.warn('[catalog-sync] full-sync inline fallback failed:', err)
      }
    }
  }

  // Refresh WhatsApp Catalogue collection covers after product items land.
  try {
    const collections = await listCollectionsByAccount(db, accountId)
    for (const collection of collections) {
      const outboxId = await enqueueCatalogSetUpsert(
        db,
        accountId,
        collection.id,
        {
          ignoreAutoSync: true,
          dispatch: false,
          inlineFallback: false,
        },
      )
      if (!outboxId || !redisOk) continue
      const ok = await enqueueCatalogMetaSync({ accountId, outboxId })
      if (!ok) redisOk = false
    }
  } catch (err) {
    console.warn('[catalog-sync] set republish failed:', err)
  }

  return { queued }
}

async function loadRetailerIdsByProduct(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>()
  if (productIds.length === 0) return byProduct
  const { data, error } = await db
    .from('catalog_variants')
    .select('product_id, retailer_id')
    .eq('account_id', accountId)
    .in('product_id', productIds)
  if (error) throw error
  for (const row of data ?? []) {
    const productId = String(row.product_id)
    const retailerId = String(row.retailer_id ?? '').trim()
    if (!retailerId) continue
    const list = byProduct.get(productId) ?? []
    if (!list.includes(retailerId)) list.push(retailerId)
    byProduct.set(productId, list)
  }
  return byProduct
}
