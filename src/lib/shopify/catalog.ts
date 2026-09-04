import type { SupabaseClient } from '@supabase/supabase-js'
import { shopifyGraphql } from './client'
import { loadShopifyConfig } from './config'
import {
  PRODUCTS_SEARCH_QUERY,
  PRODUCTS_SYNC_QUERY,
  PRODUCT_BY_ID_QUERY,
  PRODUCT_IMAGES_BY_IDS_QUERY,
} from './queries'
import {
  excerpt,
  listingImageUrls,
  mapGqlProduct,
  numericIdFromGid,
  toProductGid,
  type ShopifyGqlProduct,
} from './map-product'
import type { ShopifyProductHit, ShopifyStoreConfig, ShopifyVariantHit } from './types'
import type { ShopifyCatalogVariant } from '@/types'
import { catalogIsFresh } from './config'
import { matchProductsToAsk } from './rank'
import { cartPermalink, checkoutPermalink, productPageUrl } from './permalinks'
import { SHOPIFY_CATALOG_WEBHOOK_TOPICS } from './webhook-topics'
import { isMissingDbColumn } from './config-db'

export { SHOPIFY_CATALOG_WEBHOOK_TOPICS }
export const MAX_CATALOG_PRODUCTS = 500
const SYNC_PAGE_SIZE = 50

interface ProductsSyncData {
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
    nodes?: ShopifyGqlProduct[]
  }
}

export function sanitizeSearch(raw: string): string {
  return raw.replace(/[%_,\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

const SNAPSHOT_SELECT_WITH_BODY =
  'shopify_product_id, handle, title, body, body_excerpt, price_min, price_max, currency, variant_summary, image_url, product_url, published_at'
const SNAPSHOT_SELECT_NO_BODY =
  'shopify_product_id, handle, title, body_excerpt, price_min, price_max, currency, variant_summary, image_url, product_url, published_at'

type SnapshotSearchCol = 'title' | 'body_excerpt' | 'handle' | 'body'

function snapshotSelect(includeBody: boolean): string {
  return includeBody ? SNAPSHOT_SELECT_WITH_BODY : SNAPSHOT_SELECT_NO_BODY
}

function snapshotSearchCols(includeBody: boolean): SnapshotSearchCol[] {
  return includeBody
    ? ['title', 'handle', 'body_excerpt', 'body']
    : ['title', 'handle', 'body_excerpt']
}

export async function searchCatalogSnapshot(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit = 5,
): Promise<ShopifyProductHit[]> {
  const q = sanitizeSearch(query)
  if (!q) return []
  const pattern = `%${q}%`
  let includeBody = true

  const tryCol = async (column: SnapshotSearchCol): Promise<SnapshotRow[]> => {
    const { data, error } = await db
      .from('shopify_catalog_products')
      .select(snapshotSelect(includeBody))
      .eq('account_id', accountId)
      .ilike(column, pattern)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (error && includeBody && isMissingDbColumn(error, 'body')) {
      includeBody = false
      if (column === 'body') return []
      return tryCol(column)
    }
    if (error) {
      console.error(`[shopify catalog] snapshot search (${column}) failed:`, error)
      return []
    }
    return (data ?? []) as unknown as SnapshotRow[]
  }

  const seen = new Set<string>()
  const merged: SnapshotRow[] = []
  for (const col of snapshotSearchCols(true)) {
    if (col === 'body' && !includeBody) continue
    for (const row of await tryCol(col)) {
      if (seen.has(row.shopify_product_id)) continue
      seen.add(row.shopify_product_id)
      merged.push(row)
      if (merged.length >= limit) break
    }
    if (merged.length >= limit) break
  }
  return merged.map(rowToHit).filter((p): p is ShopifyProductHit => Boolean(p))
}

export async function listNewArrivalsSnapshot(
  db: SupabaseClient,
  accountId: string,
  limit = 10,
): Promise<ShopifyProductHit[]> {
  const run = async (includeBody: boolean) =>
    db
      .from('shopify_catalog_products')
      .select(snapshotSelect(includeBody))
      .eq('account_id', accountId)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(limit)

  let { data, error } = await run(true)
  if (error && isMissingDbColumn(error, 'body')) {
    ;({ data, error } = await run(false))
  }
  if (error) {
    console.error('[shopify catalog] new arrivals snapshot failed:', error)
    return []
  }
  return ((data ?? []) as unknown as SnapshotRow[])
    .map(rowToHit)
    .filter((p): p is ShopifyProductHit => Boolean(p))
}

export async function searchProductsLive(
  config: ShopifyStoreConfig,
  query: string,
  opts?: { first?: number; sortKey?: string; reverse?: boolean },
): Promise<ShopifyProductHit[]> {
  const q = sanitizeSearch(query)
  const data = await shopifyGraphql<{
    products?: { nodes?: ShopifyGqlProduct[] }
  }>({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    query: PRODUCTS_SEARCH_QUERY,
    variables: {
      first: opts?.first ?? 5,
      query: q || 'status:active',
      sortKey: opts?.sortKey ?? 'RELEVANCE',
      reverse: opts?.reverse ?? false,
    },
  })
  return (data.products?.nodes ?? [])
    .map((n) => mapGqlProduct(n, config.primaryDomain, config.currency))
    .filter((p): p is ShopifyProductHit => Boolean(p))
}

/** Live-fetch extra listing photos for vision confirm. Snapshot hits only have featured `imageUrl`. */
export async function hydrateListingImages(
  config: ShopifyStoreConfig,
  hits: ShopifyProductHit[],
): Promise<ShopifyProductHit[]> {
  const need = hits.filter((h) => !h.imageUrls?.length)
  if (need.length === 0) return hits
  const ids = [...new Set(need.map((h) => h.id).filter(Boolean))]
  if (ids.length === 0) return hits

  try {
    const data = await shopifyGraphql<{
      nodes?: (ShopifyGqlProduct | null)[]
    }>({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: PRODUCT_IMAGES_BY_IDS_QUERY,
      variables: { ids },
    })
    const byId = new Map<string, string[]>()
    for (const node of data.nodes ?? []) {
      if (!node?.id) continue
      const urls = listingImageUrls(node)
      if (urls.length > 0) byId.set(node.id, urls)
    }
    if (byId.size === 0) return hits
    return hits.map((hit) => {
      const urls = byId.get(hit.id)
      if (!urls?.length) return hit
      return {
        ...hit,
        imageUrl: hit.imageUrl || urls[0] || null,
        imageUrls: urls,
      }
    })
  } catch (err) {
    console.warn('[shopify catalog] listing image hydrate failed:', err)
    return hits
  }
}

export async function getProductLive(
  config: ShopifyStoreConfig,
  idOrHandleOrSku: string,
): Promise<ShopifyProductHit | null> {
  const raw = idOrHandleOrSku.trim()
  if (!raw) return null

  if (raw.startsWith('gid://') || /^\d+$/.test(raw)) {
    const data = await shopifyGraphql<{ product?: ShopifyGqlProduct | null }>({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: PRODUCT_BY_ID_QUERY,
      variables: { id: toProductGid(raw) },
    })
    return data.product
      ? mapGqlProduct(data.product, config.primaryDomain, config.currency)
      : null
  }

  const byHandle = await searchProductsLive(config, `handle:${raw}`, { first: 1 })
  if (byHandle[0]?.handle === raw) return byHandle[0]
  const bySku = await searchProductsLive(config, `sku:${raw}`, { first: 3 })
  return bySku[0] ?? byHandle[0] ?? null
}

export async function searchProducts(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  query: string,
  limit = 5,
): Promise<ShopifyProductHit[]> {
  const fetchLimit = Math.min(10, Math.max(limit * 3, limit))
  let hits: ShopifyProductHit[] = []
  if (catalogIsFresh(config)) {
    hits = matchProductsToAsk(
      query,
      await searchCatalogSnapshot(db, config.accountId, query, fetchLimit),
      limit,
    )
  }
  if (hits.length === 0) {
    try {
      hits = matchProductsToAsk(
        query,
        await searchProductsLive(config, query, { first: fetchLimit }),
        limit,
      )
    } catch (err) {
      console.warn('[shopify] live product search failed, trying snapshot:', err)
      hits = matchProductsToAsk(
        query,
        await searchCatalogSnapshot(db, config.accountId, query, fetchLimit),
        limit,
      )
    }
  }
  return hits
}

export async function listNewArrivals(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  limit = 10,
): Promise<ShopifyProductHit[]> {
  if (catalogIsFresh(config)) {
    const local = await listNewArrivalsSnapshot(db, config.accountId, limit)
    if (local.length > 0) return local
  }
  try {
    return await searchProductsLive(config, 'status:active', {
      first: limit,
      sortKey: 'CREATED_AT',
      reverse: true,
    })
  } catch (err) {
    console.warn('[shopify] live new arrivals failed, trying snapshot:', err)
    return listNewArrivalsSnapshot(db, config.accountId, limit)
  }
}

export async function listBestSelling(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  limit = 10,
): Promise<ShopifyProductHit[]> {
  try {
    return await searchProductsLive(config, 'status:active', {
      first: limit,
      sortKey: 'BEST_SELLING',
      reverse: false,
    })
  } catch (err) {
    console.warn('[shopify] live best selling failed, trying newest snapshot:', err)
    return listNewArrivalsSnapshot(db, config.accountId, limit)
  }
}

export async function syncCatalog(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
): Promise<{ count: number }> {
  const syncedAt = new Date().toISOString()
  const rows: Record<string, unknown>[] = []
  let after: string | null = null

  while (rows.length < MAX_CATALOG_PRODUCTS) {
    const data = (await shopifyGraphql({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: PRODUCTS_SYNC_QUERY,
      variables: { first: SYNC_PAGE_SIZE, after },
      timeoutMs: 45_000,
    })) as ProductsSyncData
    const nodes = data.products?.nodes ?? []
    for (const node of nodes) {
      const hit = mapGqlProduct(node, config.primaryDomain, config.currency)
      if (!hit) continue
      rows.push({
        account_id: config.accountId,
        shopify_product_id: hit.id,
        handle: hit.handle,
        title: hit.title,
        body: hit.description || null,
        body_excerpt: excerpt(hit.description),
        price_min: hit.priceMin != null ? Number(hit.priceMin) : null,
        price_max: hit.priceMax != null ? Number(hit.priceMax) : null,
        currency: hit.currency,
        variant_summary: hit.variants.map(variantToSummary),
        image_url: hit.imageUrl,
        product_url: hit.productUrl,
        published_at: node.publishedAt || node.createdAt || null,
        synced_at: syncedAt,
      })
      if (rows.length >= MAX_CATALOG_PRODUCTS) break
    }
    if (!data.products?.pageInfo?.hasNextPage || !data.products.pageInfo.endCursor) {
      break
    }
    after = data.products.pageInfo.endCursor
  }

  await db.from('shopify_catalog_products').delete().eq('account_id', config.accountId)
  if (rows.length > 0) {
    let { error } = await db.from('shopify_catalog_products').insert(rows)
    if (error && isMissingDbColumn(error, 'body')) {
      const withoutBody = rows.map(({ body: _body, ...rest }) => rest)
      ;({ error } = await db.from('shopify_catalog_products').insert(withoutBody))
    }
    if (error) throw error
  }

  const { error: updErr } = await db
    .from('shopify_configs')
    .update({
      last_catalog_sync_at: syncedAt,
      catalog_product_count: rows.length,
    })
    .eq('account_id', config.accountId)
  if (updErr) throw updErr

  return { count: rows.length }
}

export async function refreshCatalogSyncMetadata(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { count, error: countErr } = await db
    .from('shopify_catalog_products')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
  if (countErr) throw countErr

  const { error: updErr } = await db
    .from('shopify_configs')
    .update({
      last_catalog_sync_at: new Date().toISOString(),
      catalog_product_count: count ?? 0,
    })
    .eq('account_id', accountId)
  if (updErr) throw updErr
}

export async function removeCatalogProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<boolean> {
  const raw = productId.trim()
  if (!raw) return false

  const ids = new Set<string>([raw])
  if (/^\d+$/.test(raw)) {
    ids.add(toProductGid(raw))
  } else if (raw.startsWith('gid://')) {
    ids.add(numericIdFromGid(raw))
  }

  const { error, count } = await db
    .from('shopify_catalog_products')
    .delete({ count: 'exact' })
    .eq('account_id', accountId)
    .in('shopify_product_id', [...ids])

  if (error) throw error
  return (count ?? 0) > 0
}

export async function upsertCatalogProduct(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  productId: string,
): Promise<boolean> {
  const gid = toProductGid(productId)
  const data = await shopifyGraphql<{
    product?: ShopifyGqlProduct | null
  }>({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    query: PRODUCT_BY_ID_QUERY,
    variables: { id: gid },
  })

  const node = data.product
  if (!node?.id) {
    await removeCatalogProduct(db, config.accountId, gid)
    return false
  }

  const status = String(node.status ?? '').toUpperCase()
  if (status !== 'ACTIVE') {
    await removeCatalogProduct(db, config.accountId, node.id)
    return false
  }

  const hit = mapGqlProduct(node, config.primaryDomain, config.currency)
  if (!hit) return false

  const syncedAt = new Date().toISOString()
  const row = catalogRowFromHit(config, hit, node, syncedAt)
  let { error } = await db
    .from('shopify_catalog_products')
    .upsert(row, { onConflict: 'account_id,shopify_product_id' })
  if (error && isMissingDbColumn(error, 'body')) {
    const { body: _body, ...withoutBody } = row
    ;({ error } = await db
      .from('shopify_catalog_products')
      .upsert(withoutBody, { onConflict: 'account_id,shopify_product_id' }))
  }
  if (error) throw error

  await refreshCatalogSyncMetadata(db, config.accountId)
  try {
    const { pushProductToMetaCatalog } = await import('./meta-catalog-sync')
    await pushProductToMetaCatalog(db, config, hit)
  } catch (err) {
    console.warn('[shopify meta-catalog] upsert hook failed:', err)
  }
  return true
}

export async function handleShopifyProductWebhook(
  db: SupabaseClient,
  accountId: string,
  topic: string,
  body: Record<string, unknown>,
): Promise<void> {
  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  if (!config) return

  const productId =
    body.admin_graphql_api_id != null
      ? String(body.admin_graphql_api_id)
      : body.id != null
        ? String(body.id)
        : ''

  if (topic === 'products/delete') {
    if (productId) {
      await deleteMetaItemsForProduct(db, accountId, productId)
      const removed = await removeCatalogProduct(db, accountId, productId)
      if (removed) await refreshCatalogSyncMetadata(db, accountId)
    }
    return
  }

  if (topic === 'products/create' || topic === 'products/update') {
    const status =
      typeof body.status === 'string' ? body.status.trim().toLowerCase() : 'active'
    if (status !== 'active') {
      if (productId) {
        await deleteMetaItemsForProduct(db, accountId, productId)
        const removed = await removeCatalogProduct(db, accountId, productId)
        if (removed) await refreshCatalogSyncMetadata(db, accountId)
      }
      return
    }
    if (productId) {
      await upsertCatalogProduct(db, config, productId)
    }
  }
}

async function deleteMetaItemsForProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<void> {
  try {
    const raw = productId.trim()
    const ids = new Set<string>([raw])
    if (/^\d+$/.test(raw)) ids.add(toProductGid(raw))
    else if (raw.startsWith('gid://')) ids.add(numericIdFromGid(raw))

    const { data } = await db
      .from('shopify_catalog_products')
      .select('shopify_product_id, variant_summary')
      .eq('account_id', accountId)
      .in('shopify_product_id', [...ids])
      .maybeSingle()
    const variants = Array.isArray(data?.variant_summary)
      ? (data.variant_summary as ShopifyCatalogVariant[])
      : []
    const { loadCommerceSettings } = await import('./commerce-config')
    const { retailerIdForVariant } = await import('./retailer-id')
    const { deleteProductFromMetaCatalog } = await import('./meta-catalog-sync')
    const settings = await loadCommerceSettings(db, accountId)
    const retailerIds = variants
      .map((v) =>
        retailerIdForVariant(
          v,
          settings.retailerIdSource,
          String(data?.shopify_product_id ?? ''),
        ),
      )
      .filter(Boolean)
    if (retailerIds.length > 0) {
      await deleteProductFromMetaCatalog(db, accountId, retailerIds)
    }
  } catch (err) {
    console.warn('[shopify meta-catalog] delete lookup failed:', err)
  }
}

function catalogRowFromHit(
  config: ShopifyStoreConfig,
  hit: ShopifyProductHit,
  node: ShopifyGqlProduct,
  syncedAt: string,
): Record<string, unknown> {
  return {
    account_id: config.accountId,
    shopify_product_id: hit.id,
    handle: hit.handle,
    title: hit.title,
    body: hit.description || null,
    body_excerpt: excerpt(hit.description),
    price_min: hit.priceMin != null ? Number(hit.priceMin) : null,
    price_max: hit.priceMax != null ? Number(hit.priceMax) : null,
    currency: hit.currency,
    variant_summary: hit.variants.map(variantToSummary),
    image_url: hit.imageUrl,
    product_url: hit.productUrl,
    published_at: node.publishedAt || node.createdAt || null,
    synced_at: syncedAt,
  }
}

function variantToSummary(v: ShopifyVariantHit): ShopifyCatalogVariant {
  return {
    id: v.id,
    variantId: v.variantId,
    title: v.title,
    sku: v.sku,
    price: v.price,
    compareAtPrice: v.compareAtPrice,
    available: v.available,
    options: v.options,
  }
}

interface SnapshotRow {
  shopify_product_id: string
  handle: string
  title: string
  body?: string | null
  body_excerpt: string | null
  price_min: number | string | null
  price_max: number | string | null
  currency: string | null
  variant_summary: unknown
  image_url: string | null
  product_url: string | null
  published_at: string | null
}

function rowToHit(row: SnapshotRow): ShopifyProductHit | null {
  const variants = parseVariants(row.variant_summary)
  const defaultVariant = variants.find((v) => v.available) ?? variants[0] ?? null
  const originFromUrl = row.product_url ? originOf(row.product_url) : ''
  return {
    id: row.shopify_product_id,
    handle: row.handle,
    title: row.title,
    description: row.body || row.body_excerpt || '',
    imageUrl: row.image_url,
    productUrl: row.product_url || productPageUrl(originFromUrl, row.handle),
    cartUrl: defaultVariant
      ? cartPermalink(originFromUrl, defaultVariant.variantId)
      : null,
    checkoutUrl: defaultVariant
      ? checkoutPermalink(originFromUrl, defaultVariant.variantId)
      : null,
    priceMin: row.price_min != null ? String(row.price_min) : null,
    priceMax: row.price_max != null ? String(row.price_max) : null,
    currency: row.currency,
    variants,
  }
}

function parseVariants(raw: unknown): ShopifyVariantHit[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((v) => {
      if (!v || typeof v !== 'object') return null
      const o = v as Record<string, unknown>
      const variantId = String(o.variantId ?? '')
      if (!variantId) return null
      return {
        id: String(o.id ?? variantId),
        variantId,
        title: String(o.title ?? 'Default'),
        sku: typeof o.sku === 'string' ? o.sku : null,
        price: o.price != null ? String(o.price) : null,
        compareAtPrice: o.compareAtPrice != null ? String(o.compareAtPrice) : null,
        available: o.available !== false,
        options: Array.isArray(o.options)
          ? o.options
              .filter(
                (opt): opt is { name: string; value: string } =>
                  !!opt &&
                  typeof opt === 'object' &&
                  typeof (opt as { name?: unknown }).name === 'string' &&
                  typeof (opt as { value?: unknown }).value === 'string',
              )
              .map((opt) => ({ name: opt.name, value: opt.value }))
          : [],
      } satisfies ShopifyVariantHit
    })
    .filter((v): v is ShopifyVariantHit => Boolean(v))
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return ''
  }
}
