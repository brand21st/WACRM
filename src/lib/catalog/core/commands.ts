import type { SupabaseClient } from '@supabase/supabase-js'
import { scheduleCatalogEmbed } from '@/lib/catalog/embeddings/jobs'
import {
  enqueueCatalogProductDelete,
  enqueueCatalogProductUpsert,
  enqueueCatalogSetDelete,
  enqueueCatalogSetUpsert,
  enqueueCatalogSetUpserts,
} from '@/lib/catalog/sync/outbox'
import { CatalogWriteError } from '@/lib/catalog/http-write'
import {
  findProductIdByExternalId,
  getCollectionById,
  getProductByHandle,
  getProductById,
  listCollectionIdsForProduct,
  listCollectionsByAccount,
  listImportedShopifyProductIds,
} from './repository'
import { parseCatalogStatus } from './status'
import type {
  CatalogCollection,
  CatalogCollectionDraft,
  CatalogExternalIdDraft,
  CatalogMediaDraft,
  CatalogProduct,
  CatalogProductDraft,
  CatalogVariantDraft,
} from './types'

export async function upsertProduct(
  db: SupabaseClient,
  draft: CatalogProductDraft,
  options: { skipSetRepublish?: boolean } = {},
): Promise<CatalogProduct | null> {
  const accountId = draft.accountId
  const existingId = await resolveExistingProductId(db, draft)
  if (existingId) {
    const existing = await getProductById(db, accountId, existingId)
    if (existing && shouldProtectExisting(existing.origin, existing.locked, draft)) {
      return existing
    }
    const previousRetailerIds = retailerIdsOf(existing)
    const previousSetIds = await listCollectionIdsForProduct(db, accountId, existingId)
    await updateProductRow(db, existingId, accountId, draft)
    await syncChildren(db, accountId, existingId, draft)
    const saved = await getProductById(db, accountId, existingId)
    await emitCatalogSyncAfterUpsert(db, saved, previousRetailerIds)
    await emitCatalogEmbedAfterUpsert(db, saved)
    if (!options.skipSetRepublish) {
      await emitSetRepublish(db, accountId, previousSetIds, saved?.id)
    }
    return saved
  }

  const inserted = await insertProductRow(db, draft)
  if (!inserted) return null
  await syncChildren(db, accountId, inserted, draft)
  const saved = await getProductById(db, accountId, inserted)
  await emitCatalogSyncAfterUpsert(db, saved, [])
  await emitCatalogEmbedAfterUpsert(db, saved)
  if (!options.skipSetRepublish) {
    await emitSetRepublish(db, accountId, [], saved?.id)
  }
  return saved
}

export async function deleteProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<boolean> {
  const existing = await getProductById(db, accountId, productId)
  if (!existing) return false
  const retailerIds = retailerIdsOf(existing)
  const setIds = await listCollectionIdsForProduct(db, accountId, productId)
  await emitCatalogSyncDelete(db, accountId, productId, retailerIds, false)
  const { error } = await db
    .from('catalog_products')
    .delete()
    .eq('account_id', accountId)
    .eq('id', productId)
  if (error) throw error
  await enqueueCatalogSetUpserts(db, accountId, setIds)
  return true
}

export async function upsertCollection(
  db: SupabaseClient,
  draft: CatalogCollectionDraft,
): Promise<CatalogCollection | null> {
  const accountId = draft.accountId
  const handle = draft.handle.trim()
  const title = draft.title.trim()
  if (!handle || !title) {
    throw new CatalogWriteError('Set title is required')
  }
  const status = parseCatalogStatus(draft.status ?? 'active')

  const { data: handleClash, error: handleErr } = await db
    .from('catalog_collections')
    .select('id')
    .eq('account_id', accountId)
    .eq('handle', handle)
    .maybeSingle()
  if (handleErr) throw handleErr
  if (handleClash?.id && (!draft.id || String(handleClash.id) !== draft.id)) {
    throw new CatalogWriteError('That collection handle is already used')
  }

  let collectionId = draft.id ?? null
  let previousTitle: string | null = null
  if (collectionId) {
    const existing = await getCollectionById(db, accountId, collectionId)
    if (!existing) return null
    previousTitle = existing.title
    const { error } = await db
      .from('catalog_collections')
      .update({ handle, title, status })
      .eq('account_id', accountId)
      .eq('id', collectionId)
    if (error) {
      if (isUniqueViolation(error)) {
        throw new CatalogWriteError('That collection handle is already used')
      }
      throw error
    }
  } else {
    const { data: inserted, error } = await db
      .from('catalog_collections')
      .insert({
        account_id: accountId,
        handle,
        title,
        status,
      })
      .select('id')
      .maybeSingle()
    if (error) {
      if (isUniqueViolation(error)) {
        throw new CatalogWriteError('That collection handle is already used')
      }
      throw error
    }
    collectionId = inserted?.id ? String(inserted.id) : null
    if (!collectionId) {
      const { data: fallback } = await db
        .from('catalog_collections')
        .select('id')
        .eq('account_id', accountId)
        .eq('handle', handle)
        .maybeSingle()
      collectionId = fallback?.id ? String(fallback.id) : null
    }
    if (!collectionId) return null
  }

  if (draft.productIds) {
    await syncCollectionProducts(db, accountId, collectionId, draft.productIds)
  }

  const saved = await getCollectionById(db, accountId, collectionId)
  if (saved) {
    try {
      await enqueueCatalogSetUpsert(db, accountId, saved.id, {
        previousTitle:
          previousTitle && previousTitle !== saved.title
            ? previousTitle
            : undefined,
      })
    } catch (err) {
      console.warn('[catalog-sets] outbox enqueue failed:', err)
    }
  }
  return saved
}

export async function deleteCollection(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
): Promise<boolean> {
  const existing = await getCollectionById(db, accountId, collectionId)
  if (!existing) return false
  try {
    await enqueueCatalogSetDelete(db, accountId, {
      collectionId,
      title: existing.title,
      metaProductSetId: existing.metaProductSetId,
    })
  } catch (err) {
    console.warn('[catalog-sets] outbox enqueue failed:', err)
  }
  const { error } = await db
    .from('catalog_collections')
    .delete()
    .eq('account_id', accountId)
    .eq('id', collectionId)
  if (error) throw error
  return true
}

export async function deleteImportedShopifyProduct(
  db: SupabaseClient,
  accountId: string,
  shopifyProductIds: string[],
): Promise<boolean> {
  const ids = [...new Set(shopifyProductIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return false
  let deleted = false
  for (const externalId of ids) {
    const productId = await findProductIdByExternalId(
      db,
      accountId,
      'shopify',
      'product',
      externalId,
    )
    if (!productId) continue
    const existing = await getProductById(db, accountId, productId)
    if (!existing || existing.origin === 'wacrm' || existing.locked) continue
    const ok = await deleteProduct(db, accountId, productId)
    deleted = deleted || ok
  }
  return deleted
}

export async function replaceImportedAccountProducts(
  db: SupabaseClient,
  accountId: string,
  drafts: CatalogProductDraft[],
): Promise<void> {
  const keep = new Set<string>()
  for (const draft of drafts) {
    for (const ext of draft.externalIds ?? []) {
      if (ext.source === 'shopify' && ext.entity === 'product') {
        keep.add(ext.externalId)
      }
    }
    await upsertProduct(db, { ...draft, accountId }, { skipSetRepublish: true })
  }

  const imported = await listImportedShopifyProductIds(db, accountId)
  for (const row of imported) {
    const stillPresent = row.externalIds.some((id) => keep.has(id))
    if (stillPresent) continue
    await deleteProduct(db, accountId, row.productId)
  }
  const remaining = await listCollectionsByAccount(db, accountId)
  await enqueueCatalogSetUpserts(
    db,
    accountId,
    remaining.map((collection) => collection.id),
  )
}

function shouldProtectExisting(
  origin: string,
  locked: boolean,
  draft: CatalogProductDraft,
): boolean {
  if (draft.origin !== 'shopify_import') return false
  return origin === 'wacrm' || locked
}

async function resolveExistingProductId(
  db: SupabaseClient,
  draft: CatalogProductDraft,
): Promise<string | null> {
  if (draft.id) {
    const existing = await getProductById(db, draft.accountId, draft.id)
    if (existing) return existing.id
  }
  for (const ext of draft.externalIds ?? []) {
    if (ext.entity !== 'product') continue
    const id = await findProductIdByExternalId(
      db,
      draft.accountId,
      ext.source,
      'product',
      ext.externalId,
    )
    if (id) return id
  }
  const byHandle = await getProductByHandle(db, draft.accountId, draft.handle)
  return byHandle?.id ?? null
}

async function insertProductRow(
  db: SupabaseClient,
  draft: CatalogProductDraft,
): Promise<string | null> {
  const { data, error } = await db
    .from('catalog_products')
    .insert(productRow(draft))
    .select('id')
    .maybeSingle()
  if (error) {
    if (isUniqueViolation(error)) {
      const existing = await getProductByHandle(db, draft.accountId, draft.handle)
      if (existing && shouldProtectExisting(existing.origin, existing.locked, draft)) {
        return null
      }
      if (existing) {
        await updateProductRow(db, existing.id, draft.accountId, draft)
        return existing.id
      }
    }
    throw error
  }
  return data?.id ? String(data.id) : null
}

async function updateProductRow(
  db: SupabaseClient,
  productId: string,
  accountId: string,
  draft: CatalogProductDraft,
): Promise<void> {
  const { error } = await db
    .from('catalog_products')
    .update({
      handle: draft.handle,
      title: draft.title,
      description: draft.description ?? '',
      status: parseCatalogStatus(draft.status ?? 'active'),
      brand: draft.brand ?? null,
      product_url: draft.productUrl ?? null,
      currency: draft.currency ?? null,
      price_min: draft.priceMin ?? null,
      price_max: draft.priceMax ?? null,
      origin: draft.origin ?? 'wacrm',
      locked: draft.locked === true,
      published_at: draft.publishedAt ?? null,
    })
    .eq('account_id', accountId)
    .eq('id', productId)
  if (error) throw error
}

async function syncChildren(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  draft: CatalogProductDraft,
): Promise<void> {
  await syncVariants(db, accountId, productId, draft.variants ?? [])
  await syncMedia(db, accountId, productId, draft.media ?? [])
  if (draft.collectionIds) {
    await syncCollections(db, accountId, productId, draft.collectionIds)
  }
  await syncExternalIds(db, accountId, productId, null, draft.externalIds ?? [])
}

async function syncVariants(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  drafts: CatalogVariantDraft[],
): Promise<void> {
  const { data: existing, error } = await db
    .from('catalog_variants')
    .select('id, retailer_id')
    .eq('account_id', accountId)
    .eq('product_id', productId)
  if (error) throw error

  const keepIds = new Set<string>()
  const seenRetailer = new Set<string>()
  let sort = 0
  for (const draft of drafts) {
    const retailerId = draft.retailerId.trim()
    if (!retailerId || seenRetailer.has(retailerId)) continue
    seenRetailer.add(retailerId)

    const { data: taken } = await db
      .from('catalog_variants')
      .select('id, product_id')
      .eq('account_id', accountId)
      .eq('retailer_id', retailerId)
      .maybeSingle()
    if (taken?.id && String(taken.product_id) !== productId) {
      console.warn(
        `[catalog] skipped variant retailer_id=${retailerId}: already owned by another product`,
      )
      continue
    }

    const row = {
      account_id: accountId,
      product_id: productId,
      title: draft.title.trim() || 'Default',
      sku: draft.sku?.trim() || null,
      price: draft.price ?? null,
      compare_at_price: draft.compareAtPrice ?? null,
      currency: draft.currency ?? null,
      available: draft.available !== false,
      inventory_quantity: draft.inventoryQuantity ?? null,
      options: draft.options ?? [],
      sort_order: draft.sortOrder ?? sort,
      retailer_id: retailerId,
    }
    const { data: upserted, error: upErr } = await db
      .from('catalog_variants')
      .upsert(row, { onConflict: 'account_id,retailer_id' })
      .select('id')
      .maybeSingle()
    if (upErr) {
      console.warn('[catalog] variant upsert skipped:', upErr.message)
      continue
    }
    const variantId = upserted?.id ? String(upserted.id) : null
    if (variantId) {
      keepIds.add(variantId)
      await syncExternalIds(db, accountId, productId, variantId, draft.externalIds ?? [])
      await syncVariantAttributes(db, accountId, productId, variantId, draft.options ?? [])
    }
    sort += 1
  }

  const stale = (existing ?? [])
    .map((row) => String(row.id))
    .filter((id) => !keepIds.has(id))
  if (stale.length > 0) {
    const { error: delErr } = await db
      .from('catalog_variants')
      .delete()
      .eq('account_id', accountId)
      .eq('product_id', productId)
      .in('id', stale)
    if (delErr) throw delErr
  }
}

async function syncMedia(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  drafts: CatalogMediaDraft[],
): Promise<void> {
  const urls = new Set(drafts.map((item) => item.url.trim()).filter(Boolean))
  const { data: existing, error } = await db
    .from('catalog_media')
    .select('id, url')
    .eq('account_id', accountId)
    .eq('product_id', productId)
  if (error) throw error

  for (const [index, draft] of drafts.entries()) {
    const url = draft.url.trim()
    if (!url) continue
    const { error: upErr } = await db.from('catalog_media').upsert(
      {
        account_id: accountId,
        product_id: productId,
        url,
        alt: draft.alt ?? null,
        role: draft.role ?? (index === 0 ? 'hero' : 'listing'),
        sort_order: draft.sortOrder ?? index,
        storage_path: draft.storagePath ?? null,
      },
      { onConflict: 'product_id,url' },
    )
    if (upErr) throw upErr
  }

  const stale = (existing ?? [])
    .filter((row) => !urls.has(String(row.url)))
    .map((row) => String(row.id))
  if (stale.length > 0) {
    const { error: delErr } = await db
      .from('catalog_media')
      .delete()
      .eq('account_id', accountId)
      .eq('product_id', productId)
      .in('id', stale)
    if (delErr) throw delErr
  }
}

async function syncCollectionProducts(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
  productIds: string[],
): Promise<void> {
  const requested = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))]
  let keep = requested
  if (requested.length > 0) {
    const { data: owned, error: ownedErr } = await db
      .from('catalog_products')
      .select('id')
      .eq('account_id', accountId)
      .in('id', requested)
    if (ownedErr) throw ownedErr
    const ownedIds = new Set((owned ?? []).map((row) => String(row.id)))
    const foreign = requested.filter((id) => !ownedIds.has(id))
    if (foreign.length > 0) {
      throw new CatalogWriteError('Products must belong to this account')
    }
    keep = requested.filter((id) => ownedIds.has(id))
  }

  const { data: existing, error } = await db
    .from('catalog_product_collections')
    .select('id, product_id')
    .eq('account_id', accountId)
    .eq('collection_id', collectionId)
  if (error) throw error

  const existingIds = new Set((existing ?? []).map((row) => String(row.product_id)))
  for (const [index, productId] of keep.entries()) {
    if (existingIds.has(productId)) continue
    const { error: insErr } = await db.from('catalog_product_collections').insert({
      account_id: accountId,
      product_id: productId,
      collection_id: collectionId,
      sort_order: index,
    })
    if (insErr) throw insErr
  }

  const stale = (existing ?? [])
    .filter((row) => !keep.includes(String(row.product_id)))
    .map((row) => String(row.id))
  if (stale.length > 0) {
    const { error: delErr } = await db
      .from('catalog_product_collections')
      .delete()
      .eq('account_id', accountId)
      .eq('collection_id', collectionId)
      .in('id', stale)
    if (delErr) throw delErr
  }
}

async function emitSetRepublish(
  db: SupabaseClient,
  accountId: string,
  previousSetIds: string[],
  productId?: string,
): Promise<void> {
  const current = productId
    ? await listCollectionIdsForProduct(db, accountId, productId)
    : []
  try {
    await enqueueCatalogSetUpserts(db, accountId, [...previousSetIds, ...current])
  } catch (err) {
    console.warn('[catalog-sets] outbox enqueue failed:', err)
  }
}

async function syncCollections(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  collectionIds: string[],
): Promise<void> {
  const keep = [...new Set(collectionIds.map((id) => id.trim()).filter(Boolean))]
  const { data: existing, error } = await db
    .from('catalog_product_collections')
    .select('id, collection_id')
    .eq('account_id', accountId)
    .eq('product_id', productId)
  if (error) throw error

  const existingIds = new Set(
    (existing ?? []).map((row) => String(row.collection_id)),
  )
  for (const [index, collectionId] of keep.entries()) {
    if (existingIds.has(collectionId)) continue
    const { error: insErr } = await db.from('catalog_product_collections').insert({
      account_id: accountId,
      product_id: productId,
      collection_id: collectionId,
      sort_order: index,
    })
    if (insErr) throw insErr
  }

  const stale = (existing ?? [])
    .filter((row) => !keep.includes(String(row.collection_id)))
    .map((row) => String(row.id))
  if (stale.length > 0) {
    const { error: delErr } = await db
      .from('catalog_product_collections')
      .delete()
      .eq('account_id', accountId)
      .eq('product_id', productId)
      .in('id', stale)
    if (delErr) throw delErr
  }
}

async function syncExternalIds(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  variantId: string | null,
  drafts: CatalogExternalIdDraft[],
): Promise<void> {
  for (const draft of drafts) {
    const externalId = draft.externalId.trim()
    if (!externalId) continue
    const { error } = await db.from('catalog_external_ids').upsert(
      {
        account_id: accountId,
        product_id: productId,
        variant_id: variantId,
        source: draft.source,
        entity: draft.entity,
        external_id: externalId,
      },
      { onConflict: 'account_id,source,entity,external_id' },
    )
    if (error) throw error
  }
}

async function syncVariantAttributes(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  variantId: string,
  options: { name: string; value: string }[],
): Promise<void> {
  for (const option of options) {
    const label = option.name.trim()
    const value = option.value.trim()
    if (!label || !value) continue
    const key = label.toLowerCase()
    const { data: attr, error: attrErr } = await db
      .from('catalog_attributes')
      .upsert(
        { account_id: accountId, key, label },
        { onConflict: 'account_id,key' },
      )
      .select('id')
      .maybeSingle()
    if (attrErr || !attr?.id) continue

    const { data: existing } = await db
      .from('catalog_attribute_values')
      .select('id')
      .eq('account_id', accountId)
      .eq('variant_id', variantId)
      .eq('attribute_id', attr.id)
      .maybeSingle()
    if (existing?.id) {
      const { error } = await db
        .from('catalog_attribute_values')
        .update({ value })
        .eq('account_id', accountId)
        .eq('id', existing.id)
      if (error) throw error
    } else {
      const { error } = await db.from('catalog_attribute_values').insert({
        account_id: accountId,
        product_id: productId,
        variant_id: variantId,
        attribute_id: attr.id,
        value,
      })
      if (error) throw error
    }
  }
}

function productRow(draft: CatalogProductDraft) {
  return {
    account_id: draft.accountId,
    handle: draft.handle,
    title: draft.title,
    description: draft.description ?? '',
    status: parseCatalogStatus(draft.status ?? 'active'),
    brand: draft.brand ?? null,
    product_url: draft.productUrl ?? null,
    currency: draft.currency ?? null,
    price_min: draft.priceMin ?? null,
    price_max: draft.priceMax ?? null,
    origin: draft.origin ?? 'wacrm',
    locked: draft.locked === true,
    published_at: draft.publishedAt ?? null,
  }
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message ?? '')
  )
}

function retailerIdsOf(product: CatalogProduct | null): string[] {
  if (!product) return []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const variant of product.variants) {
    const id = variant.retailerId.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

async function emitCatalogEmbedAfterUpsert(
  db: SupabaseClient,
  saved: CatalogProduct | null,
): Promise<void> {
  if (!saved) return
  try {
    await scheduleCatalogEmbed(db, saved.accountId, saved.id)
  } catch (err) {
    console.warn('[catalog-embed] schedule failed:', err)
  }
}

async function emitCatalogSyncAfterUpsert(
  db: SupabaseClient,
  saved: CatalogProduct | null,
  previousRetailerIds: string[],
): Promise<void> {
  if (!saved) return
  const current = retailerIdsOf(saved)
  const stale = previousRetailerIds.filter((id) => !current.includes(id))
  try {
    if (saved.status === 'active' && current.length > 0) {
      await enqueueCatalogProductUpsert(
        db,
        saved.accountId,
        saved.id,
        current,
      )
      if (stale.length > 0) {
        await enqueueCatalogProductDelete(
          db,
          saved.accountId,
          saved.id,
          stale,
          { variantOnly: true },
        )
      }
      return
    }
    const toDelete = [...new Set([...previousRetailerIds, ...current])]
    if (toDelete.length > 0) {
      await enqueueCatalogProductDelete(db, saved.accountId, saved.id, toDelete)
    }
  } catch (err) {
    console.warn('[catalog] outbox enqueue failed:', err)
  }
}

async function emitCatalogSyncDelete(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  retailerIds: string[],
  variantOnly: boolean,
): Promise<void> {
  if (retailerIds.length === 0) return
  try {
    await enqueueCatalogProductDelete(db, accountId, productId, retailerIds, {
      variantOnly,
    })
  } catch (err) {
    console.warn('[catalog] outbox enqueue failed:', err)
  }
}
