import type { SupabaseClient } from '@supabase/supabase-js'
import { lookupCatalogProduct } from '@/lib/catalog/search/lookup'
import { findVariantByRetailerId } from '@/lib/shopify/retailer-id'
import type { CatalogProduct, CatalogVariant } from '@/lib/catalog/core/types'
import { pickCartDisplayPrice } from './inbound-order'
import type { InboundCartItem } from './types'

const NAME_MAX = 120

type CatalogHit = {
  name: string
  price?: number
  compareAt?: number
  currency?: string
  image_url?: string
}

/**
 * Fill missing product titles (and prices) from the WACRM catalog.
 * WhatsApp `order` webhooks usually send retailer IDs without names.
 * Catalog list/sale price wins over WhatsApp's line (often a ₹1 stub).
 */
export async function enrichInboundCartItems(
  db: SupabaseClient,
  accountId: string,
  items: InboundCartItem[],
): Promise<InboundCartItem[]> {
  if (items.length === 0) return items
  const hits = await resolveCatalogHits(db, accountId, items)
  return items.map((item) => {
    const hit = hits.get(item.product_retailer_id)
    if (!hit) return item
    const display = pickCartDisplayPrice({
      whatsapp: item.item_price,
      catalog: hit.price,
      compareAt: hit.compareAt,
    })
    return {
      ...item,
      name: item.name?.trim() || hit.name || undefined,
      item_price: display.unit ?? item.item_price,
      compare_at_price: display.compareAt,
      currency: item.currency || hit.currency,
      image_url: item.image_url || hit.image_url,
    }
  })
}

async function resolveCatalogHits(
  db: SupabaseClient,
  accountId: string,
  items: InboundCartItem[],
): Promise<Map<string, CatalogHit>> {
  const hits = new Map<string, CatalogHit>()
  const ids = unique(items.map((item) => item.product_retailer_id.trim()).filter(Boolean))
  if (ids.length === 0) return hits

  await resolveFromCatalogVariants(db, accountId, ids, hits)
  const afterVariants = remaining(ids, hits)
  if (afterVariants.length > 0) {
    await resolveFromExternalIds(db, accountId, afterVariants, hits)
  }
  const afterExternal = remaining(ids, hits)
  if (afterExternal.length > 0) {
    await resolveFromShopifySnapshot(db, accountId, afterExternal, hits)
  }
  const leftover = remaining(ids, hits)
  for (const id of leftover) {
    const product = await lookupCatalogProduct(db, accountId, id).catch(() => null)
    const hit = hitFromProduct(product, id)
    if (hit) hits.set(id, hit)
  }
  await fillMissingImages(db, accountId, ids, hits).catch(() => undefined)
  return hits
}

async function resolveFromCatalogVariants(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
  hits: Map<string, CatalogHit>,
): Promise<void> {
  const variants = await loadVariantsForRetailerIds(db, accountId, ids)
  if (variants.length === 0) return

  const productIds = unique(variants.map((row) => String(row.product_id ?? '')).filter(Boolean))
  const { data: products, error: productError } = await db
    .from('catalog_products')
    .select('id, title, currency')
    .eq('account_id', accountId)
    .in('id', productIds)
  if (productError) throw productError
  const images = await loadHeroImages(db, accountId, productIds).catch(
    () => new Map<string, string>(),
  )

  const productById = new Map(
    (products ?? []).map((row) => [String(row.id), row]),
  )
  for (const id of ids) {
    if (hits.has(id)) continue
    const variant = variants.find((row) => variantMatchesRetailerId(row, id))
    if (!variant) continue
    const product = productById.get(String(variant.product_id))
    const productTitle = String(product?.title ?? '').trim()
    if (!productTitle) continue
    hits.set(id, {
      name: displayName(productTitle, variant.title),
      price: toPrice(variant.price),
      compareAt: toPrice(variant.compare_at_price),
      currency:
        sanitizeCurrency(variant.currency) ||
        sanitizeCurrency(product?.currency),
      image_url: images.get(String(variant.product_id)),
    })
  }
}

async function resolveFromExternalIds(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
  hits: Map<string, CatalogHit>,
): Promise<void> {
  const needles = unique(ids.flatMap((id) => shopifyExternalCandidates(id)))
  if (needles.length === 0) return

  const { data: externals, error } = await db
    .from('catalog_external_ids')
    .select('product_id, variant_id, external_id, entity')
    .eq('account_id', accountId)
    .eq('source', 'shopify')
    .in('external_id', needles)
  if (error) throw error
  if (!externals?.length) return

  const productIds = unique(
    externals.map((row) => String(row.product_id ?? '')).filter(Boolean),
  )
  const { data: products, error: productError } = await db
    .from('catalog_products')
    .select('id, title, currency')
    .eq('account_id', accountId)
    .in('id', productIds)
  if (productError) throw productError
  const { data: variants, error: variantError } = await db
    .from('catalog_variants')
    .select('id, product_id, title, price, compare_at_price, currency, retailer_id, sku')
    .eq('account_id', accountId)
    .in('product_id', productIds)
  if (variantError) throw variantError
  const images = await loadHeroImages(db, accountId, productIds).catch(
    () => new Map<string, string>(),
  )

  const productById = new Map((products ?? []).map((row) => [String(row.id), row]))
  const variantsByProduct = new Map<string, typeof variants>()
  for (const variant of variants ?? []) {
    const key = String(variant.product_id)
    const list = variantsByProduct.get(key) ?? []
    list.push(variant)
    variantsByProduct.set(key, list)
  }

  for (const id of ids) {
    if (hits.has(id)) continue
    const candidates = new Set(shopifyExternalCandidates(id))
    const match = (externals ?? []).find((row) =>
      candidates.has(String(row.external_id ?? '')),
    )
    if (!match?.product_id) continue
    const product = productById.get(String(match.product_id))
    const productTitle = String(product?.title ?? '').trim()
    if (!productTitle) continue
    const productVariants = variantsByProduct.get(String(match.product_id)) ?? []
    const variant =
      productVariants.find((row) => String(row.id) === String(match.variant_id ?? '')) ??
      productVariants.find((row) => String(row.retailer_id) === id) ??
      productVariants.find((row) => String(row.sku ?? '') === id) ??
      productVariants[0]
    hits.set(id, {
      name: displayName(productTitle, variant?.title),
      price: toPrice(variant?.price),
      compareAt: toPrice(
        (variant as { compare_at_price?: unknown } | undefined)?.compare_at_price,
      ),
      currency:
        sanitizeCurrency(variant?.currency) ||
        sanitizeCurrency(product?.currency),
      image_url: images.get(String(match.product_id)),
    })
  }
}

async function resolveFromShopifySnapshot(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
  hits: Map<string, CatalogHit>,
): Promise<void> {
  const { data, error } = await db
    .from('shopify_catalog_products')
    .select('shopify_product_id, title, variant_summary, image_url')
    .eq('account_id', accountId)
    .limit(500)
  if (error) throw error
  const products = (data ?? []).map((row) => ({
    shopify_product_id: String(row.shopify_product_id),
    id: String(row.shopify_product_id),
    title: String(row.title ?? ''),
    variant_summary: row.variant_summary,
    image_url: sanitizeImageUrl(row.image_url),
  }))
  if (products.length === 0) return

  for (const id of ids) {
    if (hits.has(id)) continue
    const match = findVariantByRetailerId(products, id, 'sku')
    if (!match) continue
    const productTitle =
      products.find((p) => p.shopify_product_id === match.productId)?.title || id
    hits.set(id, {
      name: displayName(productTitle, match.variant.title),
      price: toPrice(match.variant.price),
      compareAt: toPrice(match.variant.compareAtPrice),
      image_url: products.find((p) => p.shopify_product_id === match.productId)
        ?.image_url,
    })
  }
}

function hitFromProduct(
  product: CatalogProduct | null,
  retailerId: string,
): CatalogHit | null {
  if (!product?.title?.trim()) return null
  const variant = matchProductVariant(product, retailerId)
  return {
    name: displayName(product.title, variant?.title),
    price: variant?.price ?? product.priceMin ?? undefined,
    compareAt: variant?.compareAtPrice ?? undefined,
    currency:
      sanitizeCurrency(variant?.currency) || sanitizeCurrency(product.currency),
    image_url: pickHeroUrl(product.media),
  }
}

function matchProductVariant(
  product: CatalogProduct,
  retailerId: string,
): CatalogVariant | undefined {
  const needle = retailerId.trim()
  return (
    product.variants.find((variant) => variant.retailerId === needle) ??
    product.variants.find((variant) => variant.sku === needle) ??
    product.variants.find((variant) =>
      product.externalIds.some(
        (ext) =>
          ext.entity === 'variant' &&
          ext.variantId === variant.id &&
          shopifyExternalCandidates(needle).includes(ext.externalId),
      ),
    ) ??
    product.variants[0]
  )
}

export function displayCatalogLineName(
  productTitle: string,
  variantTitle?: unknown,
): string {
  return displayName(productTitle, variantTitle)
}

function displayName(productTitle: string, variantTitle?: unknown): string {
  const product = productTitle.trim()
  const variant = typeof variantTitle === 'string' ? variantTitle.trim() : ''
  const name =
    variant && variant !== 'Default' ? `${product} — ${variant}` : product
  return name.slice(0, NAME_MAX)
}

function shopifyExternalCandidates(id: string): string[] {
  const raw = id.trim()
  if (!raw) return []
  if (raw.startsWith('gid://')) return [raw]
  if (/^\d+$/.test(raw)) return [raw, `gid://shopify/ProductVariant/${raw}`]
  return [raw]
}

function toPrice(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

function sanitizeCurrency(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const code = raw.trim()
  return code ? code.slice(0, 8) : undefined
}

type VariantRow = {
  product_id?: unknown
  title?: unknown
  price?: unknown
  compare_at_price?: unknown
  currency?: unknown
  retailer_id?: unknown
  sku?: unknown
}

async function loadVariantsForRetailerIds(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
): Promise<VariantRow[]> {
  if (ids.length === 0) return []
  const select = 'product_id, title, price, compare_at_price, currency, retailer_id, sku'
  const { data: exact, error } = await db
    .from('catalog_variants')
    .select(select)
    .eq('account_id', accountId)
    .in('retailer_id', ids)
  if (error) throw error

  const { data: bySku, error: skuError } = await db
    .from('catalog_variants')
    .select(select)
    .eq('account_id', accountId)
    .in('sku', ids)
  if (skuError) throw skuError

  const numeric = ids.filter((id) => /^\d+$/.test(id))
  let bySuffix: VariantRow[] = []
  if (numeric.length > 0) {
    const clause = numeric.map((id) => `retailer_id.ilike.%_${id}`).join(',')
    const { data, error: suffixError } = await db
      .from('catalog_variants')
      .select(select)
      .eq('account_id', accountId)
      .or(clause)
    if (suffixError) throw suffixError
    bySuffix = data ?? []
  }

  const seen = new Set<string>()
  const rows: VariantRow[] = []
  for (const row of [...(exact ?? []), ...(bySku ?? []), ...bySuffix]) {
    const key = `${row.product_id}:${row.retailer_id}:${row.sku ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return rows
}

async function fillMissingImages(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
  hits: Map<string, CatalogHit>,
): Promise<void> {
  const missing = ids.filter((id) => !sanitizeImageUrl(hits.get(id)?.image_url))
  if (missing.length === 0) return

  const variants = await loadVariantsForRetailerIds(db, accountId, missing).catch(() => [])
  const productIds = unique(variants.map((row) => String(row.product_id ?? '')).filter(Boolean))
  const images = productIds.length
    ? await loadHeroImages(db, accountId, productIds).catch(() => new Map<string, string>())
    : new Map<string, string>()

  for (const id of missing) {
    const variant = variants.find((row) => variantMatchesRetailerId(row, id))
    const url = variant ? images.get(String(variant.product_id)) : undefined
    if (!url) continue
    const prev = hits.get(id)
    if (prev) hits.set(id, { ...prev, image_url: url })
  }

  const still = missing.filter((id) => !sanitizeImageUrl(hits.get(id)?.image_url))
  for (const id of still) {
    const product = await lookupCatalogProduct(db, accountId, id).catch(() => null)
    const url = pickHeroUrl(product?.media ?? [])
    if (!url) continue
    const prev = hits.get(id)
    if (prev) hits.set(id, { ...prev, image_url: url })
    else {
      const hit = hitFromProduct(product, id)
      if (hit) hits.set(id, hit)
    }
  }
}

function variantMatchesRetailerId(row: VariantRow, id: string): boolean {
  const retailerId = String(row.retailer_id ?? '')
  const sku = String(row.sku ?? '')
  return (
    retailerId === id ||
    sku === id ||
    retailerId.endsWith(`_${id}`)
  )
}

async function loadHeroImages(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, string>> {
  const images = new Map<string, string>()
  if (productIds.length === 0) return images
  const { data, error } = await db
    .from('catalog_media')
    .select('product_id, url, role, sort_order')
    .eq('account_id', accountId)
    .in('product_id', productIds)
    .order('sort_order', { ascending: true })
  if (error) throw error
  const byProduct = new Map<string, Array<{ url?: unknown; role?: unknown }>>()
  for (const row of data ?? []) {
    const key = String(row.product_id ?? '')
    const list = byProduct.get(key) ?? []
    list.push(row)
    byProduct.set(key, list)
  }
  for (const [productId, media] of byProduct) {
    const url = pickHeroUrl(media)
    if (url) images.set(productId, url)
  }
  return images
}

function pickHeroUrl(
  media: Array<{ url?: unknown; role?: unknown }>,
): string | undefined {
  const hero = media.find((item) => item.role === 'hero')
  return sanitizeImageUrl(hero?.url ?? media[0]?.url)
}

function sanitizeImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const url = raw.trim()
  if (!/^https?:\/\//i.test(url)) return undefined
  return url.slice(0, 2048)
}

function remaining(ids: string[], hits: Map<string, CatalogHit>): string[] {
  return ids.filter((id) => !hits.has(id))
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
