import { numericIdFromGid, toProductGid } from '@/lib/shopify/map-product'
import { cartPermalink, checkoutPermalink, productPageUrl } from '@/lib/shopify/permalinks'
import { numericShopifyId } from '@/lib/shopify/retailer-id'
import type { ShopifyProductHit, ShopifyVariantHit } from '@/lib/shopify/types'
import type { CatalogMedia, CatalogProduct, CatalogVariant } from '../core/types'

export interface CatalogHitUrlContext {
  primaryDomain?: string | null
  currency?: string | null
}

export function catalogProductToHit(
  product: CatalogProduct,
  urls?: CatalogHitUrlContext,
): ShopifyProductHit {
  const domain = urls?.primaryDomain ?? null
  const currency = urls?.currency ?? product.currency
  const media = listingMedia(product.media)
  const imageUrls = media.map((item) => item.url).filter(Boolean)
  const variants = product.variants.map((variant) =>
    mapVariant(product, variant),
  )
  const defaultVariant =
    variants.find((variant) => variant.available && variant.variantId) ??
    variants.find((variant) => variant.variantId) ??
    null
  const canPermalink = Boolean(domain && defaultVariant?.variantId)

  return {
    id: shopifyProductId(product),
    catalogId: product.id,
    handle: product.handle,
    title: product.title,
    description: product.description,
    brand: product.brand,
    imageUrl: imageUrls[0] ?? null,
    imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
    productUrl:
      product.productUrl?.trim() || productPageUrl(domain, product.handle) || '',
    cartUrl: canPermalink
      ? cartPermalink(domain, defaultVariant!.variantId) || null
      : null,
    checkoutUrl: canPermalink
      ? checkoutPermalink(domain, defaultVariant!.variantId) || null
      : null,
    priceMin: priceString(product.priceMin),
    priceMax: priceString(product.priceMax),
    currency,
    variants,
  }
}

function mapVariant(
  product: CatalogProduct,
  variant: CatalogVariant,
): ShopifyVariantHit {
  const variantId = shopifyNumericVariantId(product, variant)
  return {
    id: variant.id,
    variantId,
    title: variant.title || 'Default',
    sku: variant.sku,
    price: priceString(variant.price),
    compareAtPrice: priceString(variant.compareAtPrice),
    available: variant.available !== false,
    options: variant.options,
    retailerId: variant.retailerId,
  }
}

function shopifyProductId(product: CatalogProduct): string {
  const ids = product.externalIds.filter(
    (item) => item.source === 'shopify' && item.entity === 'product',
  )
  const gid = ids.find((item) => item.externalId.startsWith('gid://'))
  if (gid) return gid.externalId
  const numeric = ids.find((item) => /^\d+$/.test(item.externalId))
  if (numeric) return toProductGid(numeric.externalId)
  return product.id
}

function shopifyNumericVariantId(
  product: CatalogProduct,
  variant: CatalogVariant,
): string {
  const matches = product.externalIds.filter(
    (item) =>
      item.source === 'shopify' &&
      item.entity === 'variant' &&
      (item.variantId === variant.id || !item.variantId),
  )
  for (const item of matches) {
    const numeric = numericShopifyId(item.externalId) || numericIdFromGid(item.externalId)
    if (/^\d+$/.test(numeric)) return numeric
  }
  return ''
}

function listingMedia(media: CatalogMedia[]): CatalogMedia[] {
  const roleRank = (role: CatalogMedia['role']) =>
    role === 'hero' ? 0 : role === 'listing' ? 1 : 2
  return [...media]
    .filter((item) => item.url.trim())
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.sortOrder - b.sortOrder)
}

function priceString(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return String(value)
}
