import type { SupabaseClient } from '@supabase/supabase-js'
import {
  commerceMetaCatalogIds,
  loadCommerceSettings,
} from '@/lib/shopify/commerce-config'
import {
  deleteMetaProductSet,
  findMetaProductSetIdByName,
  loadWhatsAppAccessToken,
  readMetaProductSetReview,
  upsertMetaProductSet,
} from '@/lib/shopify/meta-catalog-sync'
import { isCustomerFacingCollection } from './catalog-message-sections'
import {
  getCollectionById,
  listCollectionsByAccount,
  loadActiveRetailerIdsForCollection,
  loadCollectionCoverImageUrl,
} from '../core/repository'
import type { CatalogCollection } from '../core/types'

export interface PublishCatalogSetOptions {
  /** Manual / full sync: publish even when auto-sync is off. */
  ignoreAutoSync?: boolean
  /** Secondary catalogs: find the existing set under the previous name. */
  previousTitle?: string | null
}

export async function publishCatalogSetToMeta(
  db: SupabaseClient,
  collection: Pick<
    CatalogCollection,
    'id' | 'accountId' | 'title' | 'status' | 'metaProductSetId'
  > & { handle?: string },
  options: PublishCatalogSetOptions = {},
): Promise<void> {
  const settings = await loadCommerceSettings(db, collection.accountId)
  const catalogIds = commerceMetaCatalogIds(settings)
  if (catalogIds.length === 0) return
  const autoSyncOn =
    options.ignoreAutoSync === true || settings.metaCatalogAutoSync === true
  if (!autoSyncOn) return
  const wa = await loadWhatsAppAccessToken(db, collection.accountId)
  if (!wa) return

  const primaryId = settings.metaCatalogId?.trim() || catalogIds[0]
  const previousTitle = options.previousTitle?.trim() || null
  const facing = isCustomerFacingCollection({
    handle: collection.handle ?? '',
    title: collection.title,
  })

  if (collection.status !== 'active' || !facing) {
    await deleteSetOnCatalogs({
      catalogIds,
      primaryId,
      storedSetId: collection.metaProductSetId,
      name: collection.title,
      previousTitle,
      accessToken: wa.token,
    })
    if (collection.metaProductSetId) {
      await saveMetaProductSetId(db, collection.accountId, collection.id, null)
    }
    return
  }

  const retailerIds = await loadActiveRetailerIdsForCollection(
    db,
    collection.accountId,
    collection.id,
  )

  if (retailerIds.length === 0) {
    if (collection.metaProductSetId || previousTitle) {
      await deleteSetOnCatalogs({
        catalogIds,
        primaryId,
        storedSetId: collection.metaProductSetId,
        name: collection.title,
        previousTitle,
        accessToken: wa.token,
      })
      if (collection.metaProductSetId) {
        await saveMetaProductSetId(db, collection.accountId, collection.id, null)
      }
    }
    return
  }

  for (const catalogId of catalogIds) {
    const isPrimary = catalogId === primaryId
    const existingId = await resolveExistingSetId({
      catalogId,
      accessToken: wa.token,
      isPrimary,
      storedSetId: collection.metaProductSetId,
      title: collection.title,
      previousTitle,
    })
    const coverImageUrl = await loadCollectionCoverImageUrl(
      db,
      collection.accountId,
      collection.id,
    )
    const productSetId = await upsertMetaProductSet({
      catalogId,
      accessToken: wa.token,
      name: collection.title,
      retailerIds,
      productSetId: existingId,
      coverImageUrl,
      description: collection.title,
    })
    if (isPrimary && productSetId) {
      if (productSetId !== collection.metaProductSetId) {
        await saveMetaProductSetId(
          db,
          collection.accountId,
          collection.id,
          productSetId,
        )
      }
      const review =
        (await readMetaProductSetReview(productSetId, wa.token)) ?? 'pending'
      await saveMetaCollectionReview(
        db,
        collection.accountId,
        collection.id,
        review,
      )
    }
  }
}

export async function deleteCatalogSetOnMeta(
  db: SupabaseClient,
  accountId: string,
  productSetId: string | null | undefined,
  name?: string | null,
  previousTitle?: string | null,
): Promise<void> {
  const wa = await loadWhatsAppAccessToken(db, accountId)
  if (!wa) return
  const settings = await loadCommerceSettings(db, accountId)
  const catalogIds = commerceMetaCatalogIds(settings)
  const primaryId = settings.metaCatalogId?.trim() || catalogIds[0] || null
  await deleteSetOnCatalogs({
    catalogIds: catalogIds.length > 0 ? catalogIds : primaryId ? [primaryId] : [],
    primaryId,
    storedSetId: productSetId,
    name,
    previousTitle,
    accessToken: wa.token,
  })
}

export async function publishAllCatalogSetsToMeta(
  db: SupabaseClient,
  accountId: string,
  options: PublishCatalogSetOptions = {},
): Promise<void> {
  const sets = await listCollectionsByAccount(db, accountId)
  for (const set of sets) {
    await publishCatalogSetToMeta(db, set, options)
  }
}

export async function republishCatalogSets(
  db: SupabaseClient,
  accountId: string,
  collectionIds: string[],
  options: PublishCatalogSetOptions = {},
): Promise<void> {
  const ids = [...new Set(collectionIds.map((id) => id.trim()).filter(Boolean))]
  for (const id of ids) {
    const collection = await getCollectionById(db, accountId, id)
    if (collection) await publishCatalogSetToMeta(db, collection, options)
  }
}

export async function publishSetsForProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<void> {
  const { data, error } = await db
    .from('catalog_product_collections')
    .select('collection_id')
    .eq('account_id', accountId)
    .eq('product_id', productId)
  if (error) throw error
  await republishCatalogSets(
    db,
    accountId,
    (data ?? []).map((row) => String(row.collection_id)),
  )
}

async function resolveExistingSetId(opts: {
  catalogId: string
  accessToken: string
  isPrimary: boolean
  storedSetId: string | null | undefined
  title: string
  previousTitle: string | null
}): Promise<string | null> {
  if (opts.isPrimary && opts.storedSetId?.trim()) {
    return opts.storedSetId.trim()
  }
  if (opts.previousTitle && opts.previousTitle !== opts.title) {
    const renamed = await findMetaProductSetIdByName(
      opts.catalogId,
      opts.accessToken,
      opts.previousTitle,
    )
    if (renamed) return renamed
  }
  return findMetaProductSetIdByName(
    opts.catalogId,
    opts.accessToken,
    opts.title,
  )
}

async function deleteSetOnCatalogs(opts: {
  catalogIds: string[]
  primaryId: string | null
  storedSetId: string | null | undefined
  name?: string | null
  previousTitle?: string | null
  accessToken: string
}): Promise<void> {
  const storedId = opts.storedSetId?.trim()
  if (storedId) {
    await deleteMetaProductSet(storedId, opts.accessToken)
  }
  const names = [opts.name, opts.previousTitle]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
  const seen = new Set<string>(storedId ? [storedId] : [])
  for (const catalogId of opts.catalogIds) {
    if (opts.primaryId && catalogId === opts.primaryId && storedId) continue
    for (const setName of names) {
      const extraId = await findMetaProductSetIdByName(
        catalogId,
        opts.accessToken,
        setName,
      )
      if (extraId && !seen.has(extraId)) {
        seen.add(extraId)
        await deleteMetaProductSet(extraId, opts.accessToken)
      }
    }
  }
}

async function saveMetaProductSetId(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
  productSetId: string | null,
): Promise<void> {
  const { error } = await db
    .from('catalog_collections')
    .update({
      meta_product_set_id: productSetId,
      ...(productSetId ? {} : { meta_collection_review: null }),
    })
    .eq('account_id', accountId)
    .eq('id', collectionId)
  if (error) throw error
}

async function saveMetaCollectionReview(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
  review: 'pending' | 'live',
): Promise<void> {
  const { error } = await db
    .from('catalog_collections')
    .update({ meta_collection_review: review })
    .eq('account_id', accountId)
    .eq('id', collectionId)
  if (error) throw error
}
