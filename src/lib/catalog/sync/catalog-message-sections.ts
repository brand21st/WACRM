import type { SupabaseClient } from '@supabase/supabase-js'
import {
  listCollectionsByAccount,
  listProductIdsForCollection,
} from '../core/repository'

/** WhatsApp multi-product message caps. */
export const PRODUCT_LIST_LIMITS = {
  maxSections: 10,
  maxItems: 30,
  titleMax: 24,
} as const

export interface CatalogProductListSection {
  title: string
  productRetailerIds: string[]
}

const SKIP_HANDLES = new Set([
  'frontpage',
  'home',
  'homepage',
  'home-page',
])

export function isCustomerFacingCollection(collection: {
  handle: string
  title: string
}): boolean {
  const handle = collection.handle.trim().toLowerCase()
  const title = collection.title.trim().toLowerCase()
  if (SKIP_HANDLES.has(handle) || title === 'home page' || title === 'frontpage') {
    return false
  }
  if (/^test(\b|[-\s_0-9])/i.test(handle) || /^test(\b|[-\s_0-9])/i.test(title)) {
    return false
  }
  return Boolean(collection.title.trim())
}

export function allocateCollectionSections(
  collections: Array<{ title: string; retailerIds: string[] }>,
  limits: {
    maxSections: number
    maxItems: number
    titleMax: number
  } = PRODUCT_LIST_LIMITS,
): CatalogProductListSection[] {
  const eligible = collections
    .map((collection) => ({
      title: clipTitle(collection.title, limits.titleMax),
      retailerIds: uniqueIds(collection.retailerIds),
    }))
    .filter((collection) => collection.title && collection.retailerIds.length > 0)
    .slice(0, limits.maxSections)

  const cursors = eligible.map(() => 0)
  const buckets = eligible.map((collection) => ({
    title: collection.title,
    productRetailerIds: [] as string[],
  }))
  let used = 0
  let progressed = true
  while (used < limits.maxItems && progressed) {
    progressed = false
    for (let i = 0; i < eligible.length && used < limits.maxItems; i++) {
      const next = eligible[i].retailerIds[cursors[i]]
      if (!next) continue
      buckets[i].productRetailerIds.push(next)
      cursors[i] += 1
      used += 1
      progressed = true
    }
  }
  return buckets.filter((section) => section.productRetailerIds.length > 0)
}

export async function buildCatalogCollectionSections(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogProductListSection[]> {
  const collections = (await listCollectionsByAccount(db, accountId)).filter(
    (collection) =>
      collection.status === 'active' && isCustomerFacingCollection(collection),
  )
  const loaded: Array<{ title: string; retailerIds: string[] }> = []
  for (const collection of collections) {
    const retailerIds = await loadOneRetailerIdPerActiveProduct(
      db,
      accountId,
      collection.id,
    )
    if (retailerIds.length === 0) continue
    loaded.push({ title: collection.title, retailerIds })
  }
  return allocateCollectionSections(loaded)
}

async function loadOneRetailerIdPerActiveProduct(
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
  const active = new Set((products ?? []).map((row) => String(row.id)))
  if (active.size === 0) return []
  const { data: variants, error: variantErr } = await db
    .from('catalog_variants')
    .select('product_id, retailer_id, available')
    .eq('account_id', accountId)
    .in('product_id', [...active])
  if (variantErr) throw variantErr
  const firstByProduct = new Map<string, string>()
  for (const row of variants ?? []) {
    if (row.available === false) continue
    const productId = String(row.product_id)
    const retailerId = String(row.retailer_id ?? '').trim()
    if (!retailerId || firstByProduct.has(productId)) continue
    firstByProduct.set(productId, retailerId)
  }
  const ids: string[] = []
  for (const productId of productIds) {
    const retailerId = firstByProduct.get(productId)
    if (retailerId && !ids.includes(retailerId)) ids.push(retailerId)
  }
  return ids
}

function clipTitle(title: string, max: number): string {
  return title.trim().slice(0, max).trim()
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    const trimmed = id.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}
