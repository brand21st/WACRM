import type { ShopifyCatalogVariant } from '@/types'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'

export const RETAILER_ID_SOURCES = ['sku', 'variant_id', 'facebook_shopify'] as const

export type RetailerIdSource = (typeof RETAILER_ID_SOURCES)[number]

export function parseRetailerIdSource(raw: unknown): RetailerIdSource {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === 'variant_id' || value === 'facebook_shopify') return value
  return 'sku'
}

export function numericShopifyId(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim()
  if (!value) return ''
  const gid = value.split('/').pop() ?? value
  return /^\d+$/.test(gid) ? gid : ''
}

/**
 * Facebook's Shopify catalog connector uses
 * `shopify_{country}_{productId}_{variantId}`.
 */
export function facebookShopifyRetailerId(
  productId: string,
  variantId: string,
  country = 'IN',
): string {
  const product = numericShopifyId(productId)
  const variant = numericShopifyId(variantId)
  if (!product || !variant) return ''
  return `shopify_${country}_${product}_${variant}`
}

export function retailerIdForVariant(
  variant: Pick<ShopifyVariantHit, 'sku' | 'variantId'>,
  source: RetailerIdSource,
  productId?: string | null,
): string {
  if (source === 'sku') {
    const sku = variant.sku?.trim()
    if (sku) return sku
    return String(variant.variantId ?? '').trim()
  }
  if (source === 'facebook_shopify') {
    return (
      facebookShopifyRetailerId(productId ?? '', variant.variantId) ||
      String(variant.variantId ?? '').trim()
    )
  }
  return String(variant.variantId ?? '').trim()
}

export function retailerIdForProduct(
  product: Pick<ShopifyProductHit, 'id' | 'variants'>,
  source: RetailerIdSource,
): string {
  const variant =
    product.variants.find((v) => v.available) ?? product.variants[0]
  if (!variant) return ''
  return retailerIdForVariant(variant, source, product.id)
}

export interface RetailerMatch {
  productId: string
  variant: ShopifyVariantHit | ShopifyCatalogVariant
}

function variantMatchesRetailer(
  variant: ShopifyVariantHit | ShopifyCatalogVariant,
  retailerId: string,
  source: RetailerIdSource,
  productId: string,
): boolean {
  const needle = retailerId.trim()
  if (!needle) return false
  if (variant.sku?.trim() === needle) return true
  if (String(variant.variantId) === needle) return true
  const facebook = facebookShopifyRetailerId(productId, variant.variantId)
  if (facebook && facebook === needle) return true
  if (source === 'sku' && variant.sku?.trim() === needle) return true
  return false
}

export function parseFacebookShopifyRetailerId(
  retailerId: string,
): { productId: string; variantId: string } | null {
  const match = /^shopify_[A-Za-z]+_(\d+)_(\d+)$/.exec(retailerId.trim())
  if (!match) return null
  return { productId: match[1], variantId: match[2] }
}

export function findVariantByRetailerId(
  products: Array<{
    shopify_product_id?: string
    id?: string
    variant_summary?: unknown
    variants?: ShopifyVariantHit[]
  }>,
  retailerId: string,
  source: RetailerIdSource,
): RetailerMatch | null {
  const needle = retailerId.trim()
  if (!needle) return null
  const parsed = parseFacebookShopifyRetailerId(needle)

  for (const product of products) {
    const productId = String(product.shopify_product_id || product.id || '')
    const variants = Array.isArray(product.variants)
      ? product.variants
      : parseVariantSummary(product.variant_summary)
    for (const variant of variants) {
      if (variantMatchesRetailer(variant, needle, source, productId)) {
        return { productId, variant }
      }
      if (
        parsed &&
        numericShopifyId(productId) === parsed.productId &&
        numericShopifyId(variant.variantId) === parsed.variantId
      ) {
        return { productId, variant }
      }
    }
  }
  return null
}

function parseVariantSummary(raw: unknown): ShopifyCatalogVariant[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (v): v is ShopifyCatalogVariant =>
      !!v &&
      typeof v === 'object' &&
      typeof (v as ShopifyCatalogVariant).variantId === 'string',
  )
}
