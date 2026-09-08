import type { SupabaseClient } from '@supabase/supabase-js'
import { getCatalogProductsByIds } from '../intelligence/facts'

export type CatalogAnalyticsRange = 'today' | '7d' | '30d'

export interface CatalogAnalyticsProductRow {
  productId: string | null
  title: string
  asked: number
  shown: number
  addedToCart: number
  purchased: number
  stock: number | null
  status: string | null
}

export interface CatalogAnalyticsOverview {
  totalProducts: number
  activeProducts: number
  outOfStockProducts: number
  productsAsked: number
  productsAddedToCart: number
  productsPurchased: number
}

export interface CatalogAnalyticsDashboard {
  enabled: boolean
  range: CatalogAnalyticsRange
  since: string
  overview: CatalogAnalyticsOverview
  topAsked: CatalogAnalyticsProductRow[]
  topAddedToCart: CatalogAnalyticsProductRow[]
  topPurchased: CatalogAnalyticsProductRow[]
  products: CatalogAnalyticsProductRow[]
}

export function catalogAnalyticsSince(
  range: CatalogAnalyticsRange,
  now = new Date(),
): Date {
  const start = new Date(now)
  if (range === 'today') {
    start.setUTCHours(0, 0, 0, 0)
    return start
  }
  const days = range === '7d' ? 7 : 30
  start.setTime(start.getTime() - days * 24 * 60 * 60 * 1000)
  return start
}

export function parseCatalogAnalyticsRange(raw: string | null): CatalogAnalyticsRange {
  if (raw === 'today' || raw === '7d' || raw === '30d') return raw
  return '7d'
}

export async function loadCatalogAnalyticsDashboard(
  db: SupabaseClient,
  accountId: string,
  range: CatalogAnalyticsRange,
): Promise<Omit<CatalogAnalyticsDashboard, 'enabled'>> {
  const since = catalogAnalyticsSince(range)
  const sinceIso = since.toISOString()
  const [overview, events] = await Promise.all([
    loadCatalogOverview(db, accountId, sinceIso),
    loadAccountEvents(db, accountId, sinceIso),
  ])
  const counts = groupEventCounts(events)
  const rows = await hydrateAnalyticsRows(db, accountId, counts)
  const byId = new Map(rows.map((row) => [row.productId, row]))
  return {
    range,
    since: sinceIso,
    overview: {
      ...overview,
      productsAsked: countDistinct(events, 'search_match'),
      productsAddedToCart: countDistinct(events, 'add_to_cart'),
      productsPurchased: countDistinct(events, 'purchase'),
    },
    topAsked: topRows(byId, counts, 'search_match'),
    topAddedToCart: topRows(byId, counts, 'add_to_cart'),
    topPurchased: topRows(byId, counts, 'purchase'),
    products: rows.sort(
      (a, b) =>
        b.asked + b.shown + b.addedToCart + b.purchased -
        (a.asked + a.shown + a.addedToCart + a.purchased),
    ),
  }
}

export async function loadProductAnalytics(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  range: CatalogAnalyticsRange = '30d',
): Promise<{
  asked: number
  shown: number
  addedToCart: number
  purchased: number
}> {
  const since = catalogAnalyticsSince(range).toISOString()
  const { data, error } = await db
    .from('catalog_product_events')
    .select('event, quantity')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .gte('created_at', since)
  if (error) throw error
  const totals = { asked: 0, shown: 0, addedToCart: 0, purchased: 0 }
  for (const row of data ?? []) {
    const qty = Math.max(1, Number(row.quantity) || 1)
    if (row.event === 'search_match') totals.asked += qty
    if (row.event === 'shown') totals.shown += qty
    if (row.event === 'add_to_cart') totals.addedToCart += qty
    if (row.event === 'purchase') totals.purchased += qty
  }
  return totals
}

async function loadCatalogOverview(
  db: SupabaseClient,
  accountId: string,
  _sinceIso: string,
): Promise<Pick<CatalogAnalyticsOverview, 'totalProducts' | 'activeProducts' | 'outOfStockProducts'>> {
  const { data, error } = await db
    .from('catalog_products')
    .select('id, status')
    .eq('account_id', accountId)
  if (error) throw error
  const products = data ?? []
  const ids = products.map((row) => String(row.id))
  const variantMap = await loadVariantStock(db, accountId, ids)
  let outOfStock = 0
  for (const product of products) {
    const variants = variantMap.get(String(product.id)) ?? []
    if (variants.length === 0) continue
    if (variants.every((variant) => !variant.available || variant.inventoryQuantity === 0)) {
      outOfStock += 1
    }
  }
  return {
    totalProducts: products.length,
    activeProducts: products.filter((row) => row.status === 'active').length,
    outOfStockProducts: outOfStock,
  }
}

async function loadAccountEvents(
  db: SupabaseClient,
  accountId: string,
  sinceIso: string,
): Promise<Array<{ product_id: string | null; event: string; quantity: number }>> {
  const { data, error } = await db
    .from('catalog_product_events')
    .select('product_id, event, quantity')
    .eq('account_id', accountId)
    .gte('created_at', sinceIso)
    .limit(10000)
  if (error) throw error
  return (data ?? []).map((row) => ({
    product_id: row.product_id ? String(row.product_id) : null,
    event: String(row.event),
    quantity: Math.max(1, Number(row.quantity) || 1),
  }))
}

function groupEventCounts(
  events: Array<{ product_id: string | null; event: string; quantity: number }>,
): Map<string, { asked: number; shown: number; addedToCart: number; purchased: number }> {
  const map = new Map<string, { asked: number; shown: number; addedToCart: number; purchased: number }>()
  for (const event of events) {
    if (!event.product_id) continue
    const row = map.get(event.product_id) ?? {
      asked: 0,
      shown: 0,
      addedToCart: 0,
      purchased: 0,
    }
    if (event.event === 'search_match') row.asked += event.quantity
    if (event.event === 'shown') row.shown += event.quantity
    if (event.event === 'add_to_cart') row.addedToCart += event.quantity
    if (event.event === 'purchase') row.purchased += event.quantity
    map.set(event.product_id, row)
  }
  return map
}

async function hydrateAnalyticsRows(
  db: SupabaseClient,
  accountId: string,
  counts: Map<string, { asked: number; shown: number; addedToCart: number; purchased: number }>,
): Promise<CatalogAnalyticsProductRow[]> {
  const ids = [...counts.keys()]
  const products = await getCatalogProductsByIds(db, accountId, ids).catch(() => [])
  const byId = new Map(products.map((product) => [product.id, product]))
  return ids.map((id) => {
    const product = byId.get(id)
    const count = counts.get(id)!
    const stock = product
      ? product.variants.reduce((sum, variant) => {
          if (variant.inventoryQuantity == null) return sum
          return sum + variant.inventoryQuantity
        }, 0)
      : null
    return {
      productId: product?.id ?? id,
      title: product?.title ?? 'Deleted product',
      asked: count.asked,
      shown: count.shown,
      addedToCart: count.addedToCart,
      purchased: count.purchased,
      stock: product ? stock : null,
      status: product?.status ?? null,
    }
  })
}

function topRows(
  byId: Map<string | null, CatalogAnalyticsProductRow>,
  counts: Map<string, { asked: number; shown: number; addedToCart: number; purchased: number }>,
  event: 'search_match' | 'add_to_cart' | 'purchase',
): CatalogAnalyticsProductRow[] {
  const key =
    event === 'search_match' ? 'asked' : event === 'add_to_cart' ? 'addedToCart' : 'purchased'
  return [...counts.entries()]
    .map(([id, count]) => ({ id, n: count[key], row: byId.get(id) }))
    .filter((item) => item.n > 0 && item.row)
    .sort((a, b) => b.n - a.n)
    .slice(0, 20)
    .map((item) => item.row!)
}

function countDistinct(
  events: Array<{ product_id: string | null; event: string }>,
  event: string,
): number {
  return new Set(
    events.filter((row) => row.event === event && row.product_id).map((row) => row.product_id),
  ).size
}

async function loadVariantStock(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, Array<{ available: boolean; inventoryQuantity: number | null }>>> {
  const map = new Map<string, Array<{ available: boolean; inventoryQuantity: number | null }>>()
  if (productIds.length === 0) return map
  const { data, error } = await db
    .from('catalog_variants')
    .select('product_id, available, inventory_quantity')
    .eq('account_id', accountId)
    .in('product_id', productIds)
  if (error) throw error
  for (const row of data ?? []) {
    const id = String(row.product_id)
    const list = map.get(id) ?? []
    list.push({
      available: row.available !== false,
      inventoryQuantity:
        row.inventory_quantity == null ? null : Number(row.inventory_quantity),
    })
    map.set(id, list)
  }
  return map
}
