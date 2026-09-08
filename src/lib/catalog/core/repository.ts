import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCatalogStatus } from './status'
import type {
  CatalogCollection,
  CatalogExternalId,
  CatalogMedia,
  CatalogMediaRole,
  CatalogOption,
  CatalogOrigin,
  CatalogProduct,
  CatalogSearchQuery,
  CatalogVariant,
} from './types'

type ProductRow = {
  id: string
  account_id: string
  handle: string
  title: string
  description: string | null
  status: string
  brand: string | null
  product_url: string | null
  currency: string | null
  price_min: number | string | null
  price_max: number | string | null
  origin: string
  locked: boolean
  published_at: string | null
  created_at: string
  updated_at: string
}

type VariantRow = {
  id: string
  account_id: string
  product_id: string
  title: string
  sku: string | null
  price: number | string | null
  compare_at_price: number | string | null
  currency: string | null
  available: boolean
  inventory_quantity: number | null
  options: unknown
  sort_order: number
  retailer_id: string
}

type MediaRow = {
  id: string
  account_id: string
  product_id: string
  url: string
  alt: string | null
  role: string
  sort_order: number
  storage_path?: string | null
}

type ExternalIdRow = {
  id: string
  account_id: string
  product_id: string
  variant_id: string | null
  source: string
  entity: 'product' | 'variant'
  external_id: string
}

const PRODUCT_SELECT =
  'id, account_id, handle, title, description, status, brand, product_url, currency, price_min, price_max, origin, locked, published_at, created_at, updated_at'

export async function getProductById(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<CatalogProduct | null> {
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .eq('id', productId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return hydrateProduct(db, accountId, data as ProductRow)
}

export async function getProductByHandle(
  db: SupabaseClient,
  accountId: string,
  handle: string,
): Promise<CatalogProduct | null> {
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .eq('handle', handle)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return hydrateProduct(db, accountId, data as ProductRow)
}

export async function getProductByRetailerId(
  db: SupabaseClient,
  accountId: string,
  retailerId: string,
): Promise<CatalogProduct | null> {
  const needle = retailerId.trim()
  if (!needle) return null
  const { data, error } = await db
    .from('catalog_variants')
    .select('product_id')
    .eq('account_id', accountId)
    .eq('retailer_id', needle)
    .maybeSingle()
  if (error) throw error
  if (!data?.product_id) return null
  return getProductById(db, accountId, String(data.product_id))
}

export async function getProductBySku(
  db: SupabaseClient,
  accountId: string,
  sku: string,
): Promise<CatalogProduct | null> {
  const needle = sku.trim()
  if (!needle) return null
  const { data, error } = await db
    .from('catalog_variants')
    .select('product_id')
    .eq('account_id', accountId)
    .eq('sku', needle)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data?.product_id) return null
  return getProductById(db, accountId, String(data.product_id))
}

export async function findProductIdByExternalId(
  db: SupabaseClient,
  accountId: string,
  source: string,
  entity: 'product' | 'variant',
  externalId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('catalog_external_ids')
    .select('product_id')
    .eq('account_id', accountId)
    .eq('source', source)
    .eq('entity', entity)
    .eq('external_id', externalId)
    .maybeSingle()
  if (error) throw error
  return data?.product_id ? String(data.product_id) : null
}

export async function listImportedShopifyProductIds(
  db: SupabaseClient,
  accountId: string,
): Promise<Array<{ productId: string; externalIds: string[] }>> {
  const { data: products, error: prodErr } = await db
    .from('catalog_products')
    .select('id')
    .eq('account_id', accountId)
    .eq('origin', 'shopify_import')
    .eq('locked', false)
  if (prodErr) throw prodErr
  const ids = (products ?? []).map((row) => String(row.id))
  if (ids.length === 0) return []

  const { data: ext, error: extErr } = await db
    .from('catalog_external_ids')
    .select('product_id, external_id')
    .eq('account_id', accountId)
    .eq('source', 'shopify')
    .eq('entity', 'product')
    .in('product_id', ids)
  if (extErr) throw extErr

  const byProduct = new Map<string, string[]>()
  for (const id of ids) byProduct.set(id, [])
  for (const row of ext ?? []) {
    const productId = String(row.product_id)
    const list = byProduct.get(productId) ?? []
    list.push(String(row.external_id))
    byProduct.set(productId, list)
  }
  return [...byProduct.entries()].map(([productId, externalIds]) => ({
    productId,
    externalIds,
  }))
}

export async function listProductsByAccount(
  db: SupabaseClient,
  query: CatalogSearchQuery,
): Promise<CatalogProduct[]> {
  const limit = Math.min(500, Math.max(1, query.limit ?? 50))
  const offset = Math.max(0, query.offset ?? 0)
  let req = db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', query.accountId)
    .order('published_at', { ascending: false, nullsFirst: false })
  if (offset > 0) req = req.range(offset, offset + limit - 1)
  else req = req.limit(limit)
  if (query.status) req = req.eq('status', query.status)
  if (query.collectionId?.trim()) {
    const memberIds = await listProductIdsForCollection(
      db,
      query.accountId,
      query.collectionId.trim(),
    )
    if (memberIds.length === 0) return []
    req = req.in('id', memberIds)
  }
  if (query.text?.trim()) {
    const pattern = `%${query.text.trim()}%`
    req = req.or(`title.ilike.${pattern},description.ilike.${pattern},handle.ilike.${pattern}`)
  }

  const { data, error } = await req
  if (error) throw error
  const products = await hydrateProducts(db, query.accountId, (data ?? []) as ProductRow[])
  if (query.inStock) {
    return products.filter((product) =>
      product.variants.some((variant) => variant.available),
    )
  }
  return products
}

export { PRODUCT_SELECT }
export type { ProductRow }

export async function hydrateProduct(
  db: SupabaseClient,
  accountId: string,
  row: ProductRow,
): Promise<CatalogProduct> {
  const [product] = await hydrateProducts(db, accountId, [row])
  return product
}

export async function hydrateProducts(
  db: SupabaseClient,
  accountId: string,
  rows: ProductRow[],
): Promise<CatalogProduct[]> {
  if (rows.length === 0) return []
  const ids = rows.map((row) => row.id)
  const [variantMap, mediaMap, externalMap, collectionMap] = await Promise.all([
    loadVariantsForProducts(db, accountId, ids),
    loadMediaForProducts(db, accountId, ids),
    loadExternalIdsForProducts(db, accountId, ids),
    loadCollectionsForProducts(db, accountId, ids),
  ])
  return rows.map((row) => ({
    ...mapProductRow(row),
    variants: variantMap.get(row.id) ?? [],
    media: mediaMap.get(row.id) ?? [],
    externalIds: externalMap.get(row.id) ?? [],
    collections: collectionMap.get(row.id) ?? [],
  }))
}

export function mapProductRow(row: ProductRow): Omit<
  CatalogProduct,
  'variants' | 'media' | 'externalIds' | 'collections' | 'attributes'
> {
  return {
    id: row.id,
    accountId: row.account_id,
    handle: row.handle,
    title: row.title,
    description: row.description ?? '',
    status: parseCatalogStatus(row.status),
    brand: row.brand,
    productUrl: row.product_url,
    currency: row.currency,
    priceMin: toNumber(row.price_min),
    priceMax: toNumber(row.price_max),
    origin: row.origin === 'shopify_import' ? 'shopify_import' : 'wacrm',
    locked: row.locked === true,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadVariantsForProducts(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, CatalogVariant[]>> {
  const { data, error } = await db
    .from('catalog_variants')
    .select(
      'id, account_id, product_id, title, sku, price, compare_at_price, currency, available, inventory_quantity, options, sort_order, retailer_id',
    )
    .eq('account_id', accountId)
    .in('product_id', productIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return groupByProductId(((data ?? []) as VariantRow[]).map(mapVariant), (row) => row.productId)
}

async function loadMediaForProducts(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, CatalogMedia[]>> {
  const { data, error } = await db
    .from('catalog_media')
    .select('id, account_id, product_id, url, alt, role, sort_order, storage_path')
    .eq('account_id', accountId)
    .in('product_id', productIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
  const media = ((data ?? []) as MediaRow[]).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    url: row.url,
    alt: row.alt,
    role: (row.role === 'hero' || row.role === 'other' ? row.role : 'listing') as CatalogMediaRole,
    sortOrder: row.sort_order,
    storagePath: row.storage_path ? String(row.storage_path) : null,
  }))
  return groupByProductId(media, (row) => row.productId)
}

async function loadExternalIdsForProducts(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, CatalogExternalId[]>> {
  const { data, error } = await db
    .from('catalog_external_ids')
    .select('id, account_id, product_id, variant_id, source, entity, external_id')
    .eq('account_id', accountId)
    .in('product_id', productIds)
  if (error) throw error
  const ids = ((data ?? []) as ExternalIdRow[]).map((row) => ({
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    variantId: row.variant_id,
    source: row.source,
    entity: row.entity,
    externalId: row.external_id,
  }))
  return groupByProductId(ids, (row) => row.productId)
}

async function loadCollectionsForProducts(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, CatalogCollection[]>> {
  const map = new Map<string, CatalogCollection[]>()
  if (productIds.length === 0) return map
  const { data: links, error: linkErr } = await db
    .from('catalog_product_collections')
    .select('product_id, collection_id')
    .eq('account_id', accountId)
    .in('product_id', productIds)
  if (linkErr) throw linkErr
  const collectionIds = [
    ...new Set((links ?? []).map((row) => String(row.collection_id))),
  ]
  if (collectionIds.length === 0) return map
  const { data: collections, error: colErr } = await db
    .from('catalog_collections')
    .select('id, account_id, handle, title, status, meta_product_set_id')
    .eq('account_id', accountId)
    .in('id', collectionIds)
  if (colErr) throw colErr
  const byId = new Map(
    ((collections ?? []) as {
      id: string
      account_id: string
      handle: string
      title: string
      status: string
      meta_product_set_id?: string | null
    }[]).map((row) => [
      String(row.id),
      {
        id: String(row.id),
        accountId: String(row.account_id),
        handle: String(row.handle),
        title: String(row.title),
        status: parseCatalogStatus(row.status),
        metaProductSetId: row.meta_product_set_id ?? null,
      } satisfies CatalogCollection,
    ]),
  )
  for (const link of links ?? []) {
    const col = byId.get(String(link.collection_id))
    if (!col) continue
    const productId = String(link.product_id)
    const list = map.get(productId) ?? []
    if (!list.some((item) => item.id === col.id)) list.push(col)
    map.set(productId, list)
  }
  return map
}

function groupByProductId<T>(
  items: T[],
  productId: (item: T) => string,
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const id = productId(item)
    const list = map.get(id) ?? []
    list.push(item)
    map.set(id, list)
  }
  return map
}

function mapVariant(row: VariantRow): CatalogVariant {
  return {
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    title: row.title,
    sku: row.sku,
    price: toNumber(row.price),
    compareAtPrice: toNumber(row.compare_at_price),
    currency: row.currency,
    available: row.available !== false,
    inventoryQuantity: row.inventory_quantity,
    options: parseOptions(row.options),
    sortOrder: row.sort_order,
    retailerId: row.retailer_id,
  }
}

function parseOptions(raw: unknown): CatalogOption[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (opt): opt is CatalogOption =>
        !!opt &&
        typeof opt === 'object' &&
        typeof (opt as CatalogOption).name === 'string' &&
        typeof (opt as CatalogOption).value === 'string',
    )
    .map((opt) => ({ name: opt.name, value: opt.value }))
}

function toNumber(raw: number | string | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

export function mapOrigin(raw: string | null | undefined): CatalogOrigin {
  return raw === 'shopify_import' ? 'shopify_import' : 'wacrm'
}

export async function listCollectionsByAccount(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogCollection[]> {
  const { data, error } = await db
    .from('catalog_collections')
    .select('id, account_id, handle, title, status, meta_product_set_id')
    .eq('account_id', accountId)
    .order('title', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as {
    id: string
    account_id: string
    handle: string
    title: string
    status: string
    meta_product_set_id?: string | null
  }[]
  const counts = await countProductsByCollection(
    db,
    accountId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => ({
    id: row.id,
    accountId: row.account_id,
    handle: row.handle,
    title: row.title,
    status: parseCatalogStatus(row.status),
    metaProductSetId: row.meta_product_set_id ?? null,
    productCount: counts.get(row.id) ?? 0,
  }))
}

export async function getCollectionById(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
): Promise<CatalogCollection | null> {
  const { data, error } = await db
    .from('catalog_collections')
    .select('id, account_id, handle, title, status, meta_product_set_id')
    .eq('account_id', accountId)
    .eq('id', collectionId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const productIds = await listProductIdsForCollection(db, accountId, collectionId)
  return {
    id: String(data.id),
    accountId: String(data.account_id),
    handle: String(data.handle),
    title: String(data.title),
    status: parseCatalogStatus(String(data.status)),
    metaProductSetId: data.meta_product_set_id ? String(data.meta_product_set_id) : null,
    productCount: productIds.length,
    productIds,
  }
}

export async function listCollectionIdsForProduct(
  db: SupabaseClient,
  accountId: string,
  productId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('catalog_product_collections')
    .select('collection_id')
    .eq('account_id', accountId)
    .eq('product_id', productId)
  if (error) throw error
  return (data ?? []).map((row) => String(row.collection_id))
}

export async function listProductIdsForCollection(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('catalog_product_collections')
    .select('product_id')
    .eq('account_id', accountId)
    .eq('collection_id', collectionId)
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => String(row.product_id))
}

export async function loadCollectionCoverImageUrl(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
): Promise<string | null> {
  const productIds = await listProductIdsForCollection(db, accountId, collectionId)
  if (productIds.length === 0) return null
  const { data, error } = await db
    .from('catalog_media')
    .select('product_id, url, role, sort_order')
    .eq('account_id', accountId)
    .in('product_id', productIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
  const rows = data ?? []
  const rank = (role: unknown) =>
    role === 'hero' ? 0 : role === 'listing' ? 1 : 2
  const byProduct = new Map<string, { url: string; rank: number }>()
  for (const row of rows) {
    const url = String(row.url ?? '').trim()
    if (!/^https:\/\//i.test(url)) continue
    const productId = String(row.product_id)
    const next = { url, rank: rank(row.role) }
    const current = byProduct.get(productId)
    if (!current || next.rank < current.rank) byProduct.set(productId, next)
  }
  for (const productId of productIds) {
    const cover = byProduct.get(productId)
    if (cover) return cover.url
  }
  return null
}

export async function loadActiveRetailerIdsForCollection(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
): Promise<string[]> {
  const productIds = await listProductIdsForCollection(db, accountId, collectionId)
  if (productIds.length === 0) return []
  const { data: products, error: productErr } = await db
    .from('catalog_products')
    .select('id')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .in('id', productIds)
  if (productErr) throw productErr
  const activeIds = (products ?? []).map((row) => String(row.id))
  if (activeIds.length === 0) return []
  const { data: variants, error: variantErr } = await db
    .from('catalog_variants')
    .select('retailer_id')
    .eq('account_id', accountId)
    .in('product_id', activeIds)
  if (variantErr) throw variantErr
  const ids: string[] = []
  for (const row of variants ?? []) {
    const retailerId = String(row.retailer_id ?? '').trim()
    if (retailerId && !ids.includes(retailerId)) ids.push(retailerId)
  }
  return ids
}

async function countProductsByCollection(
  db: SupabaseClient,
  accountId: string,
  collectionIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (collectionIds.length === 0) return map
  const { data, error } = await db
    .from('catalog_product_collections')
    .select('collection_id')
    .eq('account_id', accountId)
    .in('collection_id', collectionIds)
  if (error) throw error
  for (const row of data ?? []) {
    const id = String(row.collection_id)
    map.set(id, (map.get(id) ?? 0) + 1)
  }
  return map
}
