import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductHit, ShopifyVariantHit } from '@/lib/shopify/types'
import { numericIdFromGid, toProductGid } from '@/lib/shopify/map-product'
import { slugifyCatalogHandle } from '../http-write'
import {
  deleteImportedShopifyProduct,
  replaceImportedAccountProducts,
  upsertProduct,
} from '../core/commands'
import {
  findProductIdByExternalId,
  getProductByHandle,
  listCollectionIdsForProduct,
} from '../core/repository'
import {
  catalogRetailerIdForVariant,
  parseRetailerIdSource,
  type RetailerIdSource,
} from '../core/retailer-id'
import type { CatalogProductDraft, CatalogVariantDraft } from '../core/types'

export function shopifyHitToCatalogDraft(
  accountId: string,
  hit: ShopifyProductHit,
  source: RetailerIdSource,
  extras?: {
    publishedAt?: string | null
    brand?: string | null
    collectionIds?: string[]
  },
): CatalogProductDraft {
  const productIds = uniqueIds([
    hit.id,
    numericIdFromGid(hit.id),
    /^\d+$/.test(hit.id) ? toProductGid(hit.id) : '',
  ])
  const variants: CatalogVariantDraft[] = []
  const seenRetailer = new Set<string>()
  hit.variants.forEach((variant, index) => {
    const retailerId = catalogRetailerIdForVariant(variant, source, hit.id)
    if (!retailerId || seenRetailer.has(retailerId)) return
    seenRetailer.add(retailerId)
    variants.push({
      title: variant.title,
      sku: variant.sku,
      price: toNumber(variant.price),
      compareAtPrice: toNumber(variant.compareAtPrice),
      currency: hit.currency,
      available: variant.available,
      options: variant.options,
      sortOrder: index,
      retailerId,
      externalIds: uniqueIds([variant.variantId, variant.id]).map((externalId) => ({
        source: 'shopify',
        entity: 'variant' as const,
        externalId,
      })),
    })
  })

  return {
    accountId,
    handle: hit.handle,
    title: hit.title,
    description: hit.description || '',
    status: 'active',
    brand: extras?.brand ?? null,
    productUrl: hit.productUrl,
    currency: hit.currency,
    priceMin: toNumber(hit.priceMin),
    priceMax: toNumber(hit.priceMax),
    origin: 'shopify_import',
    locked: false,
    publishedAt: extras?.publishedAt ?? null,
    collectionIds: extras?.collectionIds,
    variants,
    media: hit.imageUrl
      ? [{ url: hit.imageUrl, role: 'hero', sortOrder: 0 }]
      : [],
    externalIds: productIds.map((externalId) => ({
      source: 'shopify',
      entity: 'product',
      externalId,
    })),
  }
}

export async function importShopifyProduct(
  db: SupabaseClient,
  accountId: string,
  hit: ShopifyProductHit,
  extras?: { publishedAt?: string | null; brand?: string | null },
): Promise<void> {
  const source = await loadRetailerIdSource(db, accountId)
  const collectionIds = await collectionIdsForShopifyHit(db, accountId, hit)
  await upsertProduct(
    db,
    shopifyHitToCatalogDraft(accountId, hit, source, {
      ...extras,
      collectionIds,
    }),
  )
}

export async function replaceImportedShopifyProducts(
  db: SupabaseClient,
  accountId: string,
  hits: ShopifyProductHit[],
  extras?: { brand?: string | null; publishedAtByProductId?: Record<string, string | null> },
): Promise<void> {
  const source = await loadRetailerIdSource(db, accountId)
  const drafts: CatalogProductDraft[] = []
  for (const hit of hits) {
    drafts.push(
      shopifyHitToCatalogDraft(accountId, hit, source, {
        brand: extras?.brand,
        publishedAt: extras?.publishedAtByProductId?.[hit.id] ?? null,
        collectionIds: await collectionIdsForShopifyHit(db, accountId, hit),
      }),
    )
  }
  await replaceImportedAccountProducts(db, accountId, drafts)
}

export async function deleteImportedShopifyProductByIds(
  db: SupabaseClient,
  accountId: string,
  shopifyProductIds: string[],
): Promise<void> {
  await deleteImportedShopifyProduct(db, accountId, shopifyProductIds)
}

export async function loadRetailerIdSource(
  db: SupabaseClient,
  accountId: string,
): Promise<RetailerIdSource> {
  try {
    const { data, error } = await db
      .from('shopify_configs')
      .select('retailer_id_source')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return 'sku'
    return parseRetailerIdSource(data?.retailer_id_source)
  } catch {
    return 'sku'
  }
}

export function snapshotRowToHit(row: {
  shopify_product_id: string
  handle: string
  title: string
  body?: string | null
  body_excerpt?: string | null
  price_min?: number | string | null
  price_max?: number | string | null
  currency?: string | null
  variant_summary?: unknown
  image_url?: string | null
  product_url?: string | null
}): ShopifyProductHit {
  const variants = Array.isArray(row.variant_summary)
    ? row.variant_summary
        .map((raw) => parseSnapshotVariant(raw))
        .filter((v): v is ShopifyVariantHit => Boolean(v))
    : []
  return {
    id: row.shopify_product_id,
    handle: row.handle,
    title: row.title,
    description: row.body || row.body_excerpt || '',
    imageUrl: row.image_url ?? null,
    productUrl: row.product_url || '',
    cartUrl: null,
    checkoutUrl: null,
    priceMin: row.price_min != null ? String(row.price_min) : null,
    priceMax: row.price_max != null ? String(row.price_max) : null,
    currency: row.currency ?? null,
    variants,
  }
}

function parseSnapshotVariant(raw: unknown): ShopifyVariantHit | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
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
  }
}

async function collectionIdsForShopifyHit(
  db: SupabaseClient,
  accountId: string,
  hit: ShopifyProductHit,
): Promise<string[]> {
  const incoming = await ensureShopifyCollections(db, accountId, hit.collections ?? [])
  const existingId = await findExistingShopifyProductId(db, accountId, hit)
  if (!existingId) return incoming
  const existing = await listCollectionIdsForProduct(db, accountId, existingId)
  return [...new Set([...existing, ...incoming])]
}

async function findExistingShopifyProductId(
  db: SupabaseClient,
  accountId: string,
  hit: ShopifyProductHit,
): Promise<string | null> {
  for (const externalId of uniqueIds([
    hit.id,
    numericIdFromGid(hit.id),
    /^\d+$/.test(hit.id) ? toProductGid(hit.id) : '',
  ])) {
    const id = await findProductIdByExternalId(
      db,
      accountId,
      'shopify',
      'product',
      externalId,
    )
    if (id) return id
  }
  const byHandle = await getProductByHandle(db, accountId, hit.handle)
  return byHandle?.id ?? null
}

async function ensureShopifyCollections(
  db: SupabaseClient,
  accountId: string,
  collections: { handle: string; title: string }[],
): Promise<string[]> {
  const map = await ensureShopifyCollectionMap(db, accountId, collections)
  return collections
    .map((col) => map.get(slugifyCatalogHandle(col.handle)))
    .filter((id): id is string => Boolean(id))
}

async function ensureShopifyCollectionMap(
  db: SupabaseClient,
  accountId: string,
  collections: { handle: string; title: string }[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  const seen = new Set<string>()
  for (const collection of collections) {
    const handle = slugifyCatalogHandle(collection.handle || collection.title)
    const title = collection.title.trim()
    if (!handle || !title || seen.has(handle)) continue
    seen.add(handle)
    const id = await upsertShopifyCollectionRow(db, accountId, handle, title)
    if (id) ids.set(handle, id)
  }
  return ids
}

async function upsertShopifyCollectionRow(
  db: SupabaseClient,
  accountId: string,
  handle: string,
  title: string,
): Promise<string | null> {
  const { data: existing, error } = await db
    .from('catalog_collections')
    .select('id, title')
    .eq('account_id', accountId)
    .eq('handle', handle)
    .maybeSingle()
  if (error) throw error
  if (existing?.id) {
    if (String(existing.title ?? '') !== title) {
      const { error: updErr } = await db
        .from('catalog_collections')
        .update({ title, status: 'active' })
        .eq('account_id', accountId)
        .eq('id', existing.id)
      if (updErr) throw updErr
    }
    return String(existing.id)
  }
  const { data: inserted, error: insErr } = await db
    .from('catalog_collections')
    .insert({
      account_id: accountId,
      handle,
      title,
      status: 'active',
    })
    .select('id')
    .maybeSingle()
  if (insErr) throw insErr
  if (inserted?.id) return String(inserted.id)
  const { data: fallback } = await db
    .from('catalog_collections')
    .select('id')
    .eq('account_id', accountId)
    .eq('handle', handle)
    .maybeSingle()
  return fallback?.id ? String(fallback.id) : null
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function toNumber(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}
