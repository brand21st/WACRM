import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findVariantByRetailerId,
  parseRetailerIdSource,
  retailerIdForVariant,
} from '@/lib/shopify/retailer-id'
import { paiseFromMajor } from './money'
import type { InboundCartItem, MappedCartLine } from './types'

export async function mapCartLinesToShopify(
  db: SupabaseClient,
  accountId: string,
  items: InboundCartItem[],
  retailerIdSource: string,
): Promise<{ lines: MappedCartLine[]; missing: string[] }> {
  const source = parseRetailerIdSource(retailerIdSource)
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

  const lines: MappedCartLine[] = []
  const missing: string[] = []
  for (const item of items) {
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
    const pricePaise =
      paiseFromMajor(variant.price) || paiseFromMajor(item.item_price)
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
