import type { SupabaseClient } from '@supabase/supabase-js'
import {
  PRODUCT_SELECT,
  getProductByHandle,
  getProductById,
  getProductByRetailerId,
  hydrateProducts,
  type ProductRow,
} from '../core/repository'
import type {
  CatalogProduct,
  CatalogSearchQuery,
  CatalogSearchSort,
} from '../core/types'

const SEARCH_FETCH_CAP = 50

/**
 * FTS uses Postgres `simple` (no Malayalam dictionary). Malayalam and other
 * non-Latin queries rely on ILIKE fallback. Do not add translations or
 * embeddings here.
 */
export function sanitizeCatalogSearch(raw: string): string {
  return raw.replace(/[%_,\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function sanitizeFtsQuery(raw: string): string {
  return raw.replace(/[%_,'&|!:()\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

export function catalogSearchFetchLimit(limit?: number): number {
  const n = Math.min(SEARCH_FETCH_CAP, Math.max(1, limit ?? 10))
  return Math.min(SEARCH_FETCH_CAP, Math.max(n * 3, n))
}

export function logCatalogSearch(args: {
  accountId: string
  tool: string
  latencyMs: number
  count: number
}): void {
  console.info('[catalog-search]', {
    accountId: args.accountId,
    tool: args.tool,
    latencyMs: args.latencyMs,
    count: args.count,
    ...(args.count === 0 ? { empty: true } : {}),
  })
}

export async function searchCatalog(
  db: SupabaseClient,
  query: CatalogSearchQuery,
): Promise<CatalogProduct[]> {
  const started = Date.now()
  const status = query.status ?? 'active'
  const fetchLimit = catalogSearchFetchLimit(query.limit)
  const text = sanitizeCatalogSearch(query.text ?? '')
  const sort: CatalogSearchSort = query.sort ?? (text ? 'relevance' : 'newest')

  try {
    const rows = await collectProductRows(db, {
      ...query,
      status,
      text,
      sort,
      fetchLimit,
    })
    let products = await hydrateProducts(db, query.accountId, rows)
    products = applyInMemoryFilters(products, query)
    products = sortProducts(products, sort)
    const limited = products.slice(0, fetchLimit)
    logCatalogSearch({
      accountId: query.accountId,
      tool: 'searchCatalog',
      latencyMs: Date.now() - started,
      count: limited.length,
    })
    return limited
  } catch (err) {
    console.warn('[catalog-search] query failed', {
      accountId: query.accountId,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

export async function listNewArrivalsCatalog(
  db: SupabaseClient,
  accountId: string,
  limit = 10,
): Promise<CatalogProduct[]> {
  return searchCatalog(db, {
    accountId,
    status: 'active',
    sort: 'newest',
    limit,
  })
}

export async function getCatalogProduct(
  db: SupabaseClient,
  accountId: string,
  id: string,
): Promise<CatalogProduct | null> {
  return getProductById(db, accountId, id)
}

export async function getCatalogProductByHandle(
  db: SupabaseClient,
  accountId: string,
  handle: string,
): Promise<CatalogProduct | null> {
  return getProductByHandle(db, accountId, handle)
}

export async function getCatalogProductByRetailerId(
  db: SupabaseClient,
  accountId: string,
  retailerId: string,
): Promise<CatalogProduct | null> {
  return getProductByRetailerId(db, accountId, retailerId)
}

async function collectProductRows(
  db: SupabaseClient,
  query: CatalogSearchQuery & { text: string; sort: CatalogSearchSort; fetchLimit: number },
): Promise<ProductRow[]> {
  const scoped = () =>
    applyProductFilters(
      db.from('catalog_products').select(PRODUCT_SELECT) as unknown as ProductQuery,
      query,
    )

  const seen = new Map<string, ProductRow>()
  const add = (rows: ProductRow[]) => {
    for (const row of rows) {
      if (!seen.has(row.id)) seen.set(row.id, row)
    }
  }

  if (query.text) {
    const fts = sanitizeFtsQuery(query.text)
    if (fts) {
      try {
        add(await fetchRows(scoped().textSearch('fts', fts, { type: 'websearch', config: 'simple' }).limit(query.fetchLimit)))
      } catch (err) {
        console.warn('[catalog-search] FTS failed, using ILIKE', {
          accountId: query.accountId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    if (seen.size === 0) {
      const pattern = `%${query.text}%`
      add(
        await fetchRows(
          scoped()
            .or(`title.ilike.${pattern},handle.ilike.${pattern},brand.ilike.${pattern}`)
            .limit(query.fetchLimit),
        ),
      )
    }
    add(await fetchProductsForVariantText(db, query.accountId, query.text, query.fetchLimit))
  } else {
    add(await fetchRows(applySort(scoped(), query.sort).limit(query.fetchLimit)))
  }

  let rows = [...seen.values()]
  rows = await restrictToCollection(db, query, rows)
  rows = await restrictToAttribute(db, query, rows)
  return rows
}

async function fetchProductsForVariantText(
  db: SupabaseClient,
  accountId: string,
  text: string,
  limit: number,
): Promise<ProductRow[]> {
  const pattern = `%${text}%`
  const { data, error } = await db
    .from('catalog_variants')
    .select('product_id')
    .eq('account_id', accountId)
    .or(`sku.eq.${text},sku.ilike.${pattern},title.ilike.${pattern}`)
    .limit(limit)
  if (error) throw error
  const ids = unique((data ?? []).map((row) => String(row.product_id)).filter(Boolean))
  if (ids.length === 0) return []
  return fetchRows(
    db
      .from('catalog_products')
      .select(PRODUCT_SELECT)
      .eq('account_id', accountId)
      .in('id', ids),
  )
}

type ProductQuery = {
  eq: (column: string, value: unknown) => ProductQuery
  ilike: (column: string, value: string) => ProductQuery
  gte: (column: string, value: unknown) => ProductQuery
  lte: (column: string, value: unknown) => ProductQuery
  or: (clause: string) => ProductQuery
  textSearch: (
    column: string,
    query: string,
    opts?: { type?: string; config?: string },
  ) => ProductQuery
  order: (
    column: string,
    opts?: { ascending?: boolean; nullsFirst?: boolean },
  ) => ProductQuery
  limit: (n: number) => PromiseLike<{ data: unknown; error: { message?: string } | null }>
  in: (column: string, values: unknown[]) => PromiseLike<{
    data: unknown
    error: { message?: string } | null
  }>
}

function applyProductFilters(
  req: ProductQuery,
  query: CatalogSearchQuery,
): ProductQuery {
  let next = req.eq('account_id', query.accountId)
  if (query.status) next = next.eq('status', query.status)
  if (query.brand?.trim()) {
    next = next.ilike('brand', `%${sanitizeCatalogSearch(query.brand)}%`)
  }
  if (query.priceMin != null) next = next.gte('price_max', query.priceMin)
  if (query.priceMax != null) next = next.lte('price_min', query.priceMax)
  return next
}

function applySort(req: ProductQuery, sort: CatalogSearchSort): ProductQuery {
  if (sort === 'price_asc') return req.order('price_min', { ascending: true, nullsFirst: false })
  if (sort === 'price_desc') return req.order('price_min', { ascending: false, nullsFirst: false })
  return req
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
}

async function restrictToCollection(
  db: SupabaseClient,
  query: CatalogSearchQuery,
  rows: ProductRow[],
): Promise<ProductRow[]> {
  const handle = query.collectionHandle?.trim()
  let collectionId = query.collectionId?.trim() || ''
  if (!collectionId && !handle) return rows
  if (!collectionId && handle) {
    const { data, error } = await db
      .from('catalog_collections')
      .select('id')
      .eq('account_id', query.accountId)
      .eq('handle', handle)
      .maybeSingle()
    if (error) throw error
    collectionId = data?.id ? String(data.id) : ''
  }
  if (!collectionId) return []
  const { data, error } = await db
    .from('catalog_product_collections')
    .select('product_id')
    .eq('account_id', query.accountId)
    .eq('collection_id', collectionId)
  if (error) throw error
  const allowed = new Set((data ?? []).map((row) => String(row.product_id)))
  return rows.filter((row) => allowed.has(row.id))
}

async function restrictToAttribute(
  db: SupabaseClient,
  query: CatalogSearchQuery,
  rows: ProductRow[],
): Promise<ProductRow[]> {
  const key = query.attribute?.key.trim()
  const value = query.attribute?.value.trim()
  if (!key || !value) return rows
  const { data: attrs, error: attrError } = await db
    .from('catalog_attributes')
    .select('id')
    .eq('account_id', query.accountId)
    .ilike('key', key)
  if (attrError) throw attrError
  const attributeIds = (attrs ?? [])
    .map((row) => String((row as { id?: string }).id ?? ''))
    .filter(Boolean)
  if (attributeIds.length === 0) return []
  const { data, error } = await db
    .from('catalog_attribute_values')
    .select('product_id')
    .eq('account_id', query.accountId)
    .in('attribute_id', attributeIds)
    .ilike('value', value)
  if (error) throw error
  const allowed = new Set((data ?? []).map((row) => String(row.product_id)))
  return rows.filter((row) => allowed.has(row.id))
}

function applyInMemoryFilters(
  products: CatalogProduct[],
  query: CatalogSearchQuery,
): CatalogProduct[] {
  return products.filter((product) => {
    if (query.inStock && !product.variants.some((variant) => variant.available)) {
      return false
    }
    if (query.option?.name && query.option.value) {
      const name = query.option.name.trim().toLowerCase()
      const value = query.option.value.trim().toLowerCase()
      const matches = product.variants.some((variant) =>
        variant.options.some(
          (opt) =>
            opt.name.toLowerCase() === name && opt.value.toLowerCase() === value,
        ),
      )
      if (!matches) return false
    }
    if (query.priceMin != null || query.priceMax != null) {
      const min = product.priceMin
      const max = product.priceMax
      if (min == null && max == null) return false
      const hi = max ?? min ?? 0
      const lo = min ?? max ?? 0
      if (query.priceMin != null && hi < query.priceMin) return false
      if (query.priceMax != null && lo > query.priceMax) return false
    }
    return true
  })
}

function sortProducts(
  products: CatalogProduct[],
  sort: CatalogSearchSort,
): CatalogProduct[] {
  if (sort === 'relevance') return products
  const copy = [...products]
  copy.sort((a, b) => {
    if (sort === 'price_asc') return (a.priceMin ?? Number.POSITIVE_INFINITY) - (b.priceMin ?? Number.POSITIVE_INFINITY)
    if (sort === 'price_desc') return (b.priceMin ?? Number.NEGATIVE_INFINITY) - (a.priceMin ?? Number.NEGATIVE_INFINITY)
    const published = compareNullableDate(b.publishedAt, a.publishedAt)
    if (published !== 0) return published
    return b.createdAt.localeCompare(a.createdAt)
  })
  return copy
}

function compareNullableDate(a: string | null, b: string | null): number {
  if (a && b) return a.localeCompare(b)
  if (a) return 1
  if (b) return -1
  return 0
}

async function fetchRows(req: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<ProductRow[]> {
  const { data, error } = await req
  if (error) throw error
  return (data ?? []) as ProductRow[]
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}
