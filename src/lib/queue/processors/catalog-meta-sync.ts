import { supabaseAdmin } from '@/lib/ai/admin-client'
import { catalogItemsFromCatalogProduct } from '@/lib/catalog/sync/meta-mapper'
import {
  claimCatalogSyncOutbox,
  hasPendingProductCatalogSync,
  isCatalogSetOp,
  markCatalogSyncOutboxFailed,
  markCatalogSyncOutboxPending,
  markCatalogSyncOutboxSucceeded,
  type CatalogSyncOutboxRow,
} from '@/lib/catalog/sync/outbox'
import {
  getCollectionById,
  getProductById,
  listProductIdsForCollection,
} from '@/lib/catalog/core/repository'
import {
  deleteCatalogSetOnMeta,
  publishCatalogSetToMeta,
} from '@/lib/catalog/sync/product-sets'
import {
  commerceMetaCatalogIds,
  loadCommerceSettings,
} from '@/lib/shopify/commerce-config'
import {
  CatalogSetSyncWaitError,
  catalogIdLooksLikeWhatsAppAsset,
  deleteMetaCatalogItems,
  explainMetaCatalogSyncError,
  isMetaItemNotFoundError,
  isRetryableMetaCatalogError,
  listWabaProductCatalogs,
  loadWhatsAppAccessToken,
  upsertMetaCatalogItems,
} from '@/lib/shopify/meta-catalog-sync'
import type { CatalogMetaSyncJob } from '@/lib/queue/jobs'

/**
 * Sole Meta Commerce writer after Phase 2.
 * Reloads canonical catalog_* data for upserts; uses persisted retailer_ids for deletes.
 */
export async function processCatalogMetaSync(
  job: CatalogMetaSyncJob,
): Promise<void> {
  const db = supabaseAdmin()
  const claimed = await claimCatalogSyncOutbox(db, job.accountId, job.outboxId)
  if (!claimed) return

  try {
    const itemCount = await applyClaimedEvent(db, claimed)
    await markCatalogSyncOutboxSucceeded(db, job.accountId, job.outboxId)
    await persistSyncSuccess(db, job.accountId, itemCount)
  } catch (err) {
    const message = catalogSyncErrorMessage(err)
    if (isRetryableMetaCatalogError(err)) {
      await markCatalogSyncOutboxPending(
        db,
        job.accountId,
        job.outboxId,
        message,
      )
      await persistSyncFailure(db, job.accountId, message)
      throw err
    }
    await markCatalogSyncOutboxFailed(db, job.accountId, job.outboxId, message)
    await persistSyncFailure(db, job.accountId, message)
  }
}

async function applyClaimedEvent(
  db: ReturnType<typeof supabaseAdmin>,
  claimed: CatalogSyncOutboxRow,
): Promise<number> {
  const settings = await loadCommerceSettings(db, claimed.accountId)
  const catalogIds = commerceMetaCatalogIds(settings)
  if (catalogIds.length === 0) {
    throw new PermanentCatalogSyncError('Set a WhatsApp catalog ID first')
  }

  const wa = await loadWhatsAppAccessToken(db, claimed.accountId)
  if (!wa) {
    throw new PermanentCatalogSyncError(
      'Connect WhatsApp before syncing the Meta catalog',
    )
  }

  for (const catalogId of catalogIds) {
    const swapped = catalogIdLooksLikeWhatsAppAsset(
      catalogId,
      wa.phoneNumberId,
      wa.wabaId,
    )
    if (swapped) throw new PermanentCatalogSyncError(swapped)
  }

  if (isCatalogSetOp(claimed.op)) {
    return applySetEvent(db, claimed)
  }

  const retailerIds = claimed.retailerIds
  const product = claimed.productId
    ? await getProductById(db, claimed.accountId, claimed.productId)
    : null

  const shouldDelete =
    claimed.op === 'delete' || !product || product.status !== 'active'

  try {
    if (shouldDelete) {
      const ids = retailerIds
      if (ids.length === 0) return 0
      for (const catalogId of catalogIds) {
        await deleteMetaCatalogItems(catalogId, wa.token, ids)
      }
      return 0
    }

    const items = catalogItemsFromCatalogProduct(product)
    if (items.length === 0) {
      if (retailerIds.length > 0) {
        for (const catalogId of catalogIds) {
          await deleteMetaCatalogItems(catalogId, wa.token, retailerIds)
        }
      }
      return 0
    }
    for (const catalogId of catalogIds) {
      await upsertMetaCatalogItems(catalogId, wa.token, items)
    }
    return items.length
  } catch (err) {
    if (shouldDelete && isMetaItemNotFoundError(err)) return 0
    if (isRetryableMetaCatalogError(err)) throw err
    const connected = await listWabaProductCatalogs(wa.wabaId, wa.token)
    throw new PermanentCatalogSyncError(
      explainMetaCatalogSyncError({
        catalogId: catalogIds[0],
        graphMessage: err instanceof Error ? err.message : String(err),
        phoneNumberId: wa.phoneNumberId,
        wabaId: wa.wabaId,
        connected,
      }),
    )
  }
}

async function applySetEvent(
  db: ReturnType<typeof supabaseAdmin>,
  claimed: CatalogSyncOutboxRow,
): Promise<number> {
  if (claimed.op === 'set_delete') {
    await deleteCatalogSetOnMeta(
      db,
      claimed.accountId,
      claimed.payload.metaProductSetId,
      claimed.payload.title,
      claimed.payload.previousTitle,
    )
    return 0
  }

  const collection = claimed.collectionId
    ? await getCollectionById(db, claimed.accountId, claimed.collectionId)
    : null

  if (!collection || collection.status !== 'active') {
    await deleteCatalogSetOnMeta(
      db,
      claimed.accountId,
      collection?.metaProductSetId ?? claimed.payload.metaProductSetId,
      collection?.title ?? claimed.payload.title,
      claimed.payload.previousTitle,
    )
    return 0
  }

  const memberIds = await listProductIdsForCollection(
    db,
    claimed.accountId,
    collection.id,
  )
  if (
    memberIds.length > 0 &&
    (await hasPendingProductCatalogSync(db, claimed.accountId, memberIds))
  ) {
    throw new CatalogSetSyncWaitError()
  }

  await publishCatalogSetToMeta(db, collection, {
    ignoreAutoSync: true,
    previousTitle: claimed.payload.previousTitle,
  })
  return 1
}

function catalogSyncErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

class PermanentCatalogSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentCatalogSyncError'
  }
}

async function persistSyncSuccess(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  itemCount: number,
): Promise<void> {
  const now = new Date().toISOString()
  await db.from('catalog_sync_state').upsert(
    {
      account_id: accountId,
      channel: 'meta',
      last_synced_at: now,
      item_count: itemCount,
      last_error: null,
    },
    { onConflict: 'account_id,channel' },
  )
  const configPatch: Record<string, unknown> = {
    last_meta_catalog_sync_at: now,
  }
  if (itemCount > 0) configPatch.meta_catalog_item_count = itemCount
  await db.from('shopify_configs').update(configPatch).eq('account_id', accountId)
}

async function persistSyncFailure(
  db: ReturnType<typeof supabaseAdmin>,
  accountId: string,
  lastError: string,
): Promise<void> {
  const { data } = await db
    .from('catalog_sync_state')
    .select('id, item_count, last_synced_at')
    .eq('account_id', accountId)
    .eq('channel', 'meta')
    .maybeSingle()
  await db.from('catalog_sync_state').upsert(
    {
      account_id: accountId,
      channel: 'meta',
      last_synced_at: data?.last_synced_at ?? null,
      item_count: data?.item_count ?? 0,
      last_error: lastError.slice(0, 2000),
    },
    { onConflict: 'account_id,channel' },
  )
}
