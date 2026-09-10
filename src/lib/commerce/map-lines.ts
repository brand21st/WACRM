import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findVariantByRetailerId,
  parseRetailerIdSource,
  retailerIdForVariant,
} from '@/lib/shopify/retailer-id'
import { pickCartDisplayPrice } from './inbound-order'
import { paiseFromMajor } from './money'
import type { InboundCartItem, MappedCartLine } from './types'

export async function mapCartLinesToShopify(
  db: SupabaseClient,
  accountId: string,
  items: InboundCartItem[],
  retailerIdSource: string,
): Promise<{ lines: MappedCartLine[]; missing: string[] }> {
  const source = parseRetailerIdSource(retailerIdSource)
  const lines: MappedCartLine[] = []
  const missing: string[] = []
  const unresolved: InboundCartItem[] = []

  for (const item of items) {
    const catalogLine = await mapLineFromCatalogVariant(db, accountId, item)
    if (catalogLine) {
      lines.push(catalogLine)
      continue
    }
    unresolved.push(item)
  }

  if (unresolved.length === 0) return { lines, missing }

  const { data, error } = await db
    .from('shopify_catalog_products')
    .select('shopify_product_id, title, variant_summary')
    .eq('account_id', accountId)
    .limit(500)
  if (error) throw error

  const products = (data ?? []).map((row) => ({
    shopify_product_id: String(row.shopify_product_id),
    id: String(row.shopify_product_id),
    title: String(row.title ?? ''),
    variant_summary: row.variant_summary,
  }))

  for (const item of unresolved) {
    const match = findVariantByRetailerId(
      products,
      item.product_retailer_id,
      source,
    )
    if (!match) {
      missing.push(item.product_retailer_id)
      continue
    }
    const variant = match.variant
    const pricePaise = lineAmountPaise({
      catalog: toMajor(variant.price),
      compareAt: toMajor(variant.compareAtPrice),
      whatsapp: item.item_price,
    })
    const productTitle =
      products.find((p) => p.shopify_product_id === match.productId)?.title ||
      item.name ||
      item.product_retailer_id
    const name =
      variant.title && variant.title !== 'Default'
        ? `${productTitle} — ${variant.title}`
        : productTitle
    lines.push({
      retailer_id:
        retailerIdForVariant(variant, source, match.productId) ||
        item.product_retailer_id,
      name: name.slice(0, 60),
      quantity: item.quantity,
      amountPaise: pricePaise,
      variantId: String(variant.variantId),
      productId: match.productId,
      sku: variant.sku ?? null,
    })
  }

  return { lines, missing }
}

async function mapLineFromCatalogVariant(
  db: SupabaseClient,
  accountId: string,
  item: InboundCartItem,
): Promise<MappedCartLine | null> {
  const retailerId = item.product_retailer_id.trim()
  if (!retailerId) return null
  const variant = await findCatalogVariant(db, accountId, retailerId)
  if (!variant?.id) return null

  const { data: product } = await db
    .from('catalog_products')
    .select('id, title')
    .eq('account_id', accountId)
    .eq('id', variant.product_id)
    .maybeSingle()
  if (!product?.id) return null

  const { data: externals } = await db
    .from('catalog_external_ids')
    .select('entity, external_id, variant_id')
    .eq('account_id', accountId)
    .eq('product_id', product.id)

  const shopifyProduct =
    (externals ?? []).find(
      (row) => row.entity === 'product' && String(row.external_id).startsWith('gid://'),
    )?.external_id ??
    (externals ?? []).find((row) => row.entity === 'product')?.external_id ??
    String(product.id)
  const shopifyVariant =
    (externals ?? []).find(
      (row) =>
        row.entity === 'variant' &&
        String(row.variant_id ?? '') === String(variant.id),
    )?.external_id ?? String(variant.id)

  const productTitle = String(product.title ?? item.name ?? retailerId)
  const variantTitle = String(variant.title ?? '')
  const name =
    variantTitle && variantTitle !== 'Default'
      ? `${productTitle} — ${variantTitle}`
      : productTitle

  return {
    retailer_id: String(variant.retailer_id || retailerId),
    name: name.slice(0, 60),
    quantity: item.quantity,
    amountPaise: lineAmountPaise({
      catalog: toMajor(variant.price),
      compareAt: toMajor(variant.compare_at_price),
      whatsapp: item.item_price,
    }),
    variantId: String(shopifyVariant),
    productId: String(shopifyProduct),
    sku: variant.sku ? String(variant.sku) : null,
  }
}

type CatalogVariantRow = {
  id?: unknown
  product_id?: unknown
  title?: unknown
  sku?: unknown
  price?: unknown
  compare_at_price?: unknown
  retailer_id?: unknown
}

async function findCatalogVariant(
  db: SupabaseClient,
  accountId: string,
  retailerId: string,
): Promise<CatalogVariantRow | null> {
  const select = 'id, product_id, title, sku, price, compare_at_price, retailer_id'
  const { data: exact, error } = await db
    .from('catalog_variants')
    .select(select)
    .eq('account_id', accountId)
    .eq('retailer_id', retailerId)
    .maybeSingle()
  if (!error && exact?.id) return exact

  const { data: bySku, error: skuError } = await db
    .from('catalog_variants')
    .select(select)
    .eq('account_id', accountId)
    .eq('sku', retailerId)
    .maybeSingle()
  if (!skuError && bySku?.id) return bySku

  if (!/^\d+$/.test(retailerId)) return null
  const { data: bySuffix, error: suffixError } = await db
    .from('catalog_variants')
    .select(select)
    .eq('account_id', accountId)
    .or(`retailer_id.ilike.%_${retailerId}`)
  if (suffixError || !bySuffix?.length) return null
  return (
    bySuffix.find((row) => String(row.retailer_id ?? '').endsWith(`_${retailerId}`)) ??
    null
  )
}

function lineAmountPaise(args: {
  catalog?: number
  compareAt?: number
  whatsapp?: number
}): number {
  const display = pickCartDisplayPrice(args)
  return paiseFromMajor(display.unit)
}

function toMajor(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim())
  return Number.isFinite(n) && n >= 0 ? n : undefined
}
