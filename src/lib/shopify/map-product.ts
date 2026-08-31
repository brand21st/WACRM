import { checkoutPermalink, cartPermalink, productPageUrl } from './permalinks'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'

export interface ShopifyGqlVariant {
  id?: string
  legacyResourceId?: string | number | null
  title?: string | null
  sku?: string | null
  availableForSale?: boolean | null
  selectedOptions?: { name?: string; value?: string }[] | null
  price?: string | number | null
  compareAtPrice?: string | number | null
  inventoryQuantity?: number | null
}

export interface ShopifyGqlProduct {
  id?: string
  handle?: string | null
  title?: string | null
  status?: string | null
  description?: string | null
  createdAt?: string | null
  publishedAt?: string | null
  featuredImage?: { url?: string | null } | null
  variants?: { nodes?: ShopifyGqlVariant[] | null } | null
}

export function mapGqlProduct(
  node: ShopifyGqlProduct,
  primaryDomain: string | null,
  currency: string | null,
): ShopifyProductHit | null {
  const handle = (node.handle || '').trim()
  const title = (node.title || '').trim()
  if (!node.id || !handle || !title) return null

  const variants: ShopifyVariantHit[] = (node.variants?.nodes ?? [])
    .map((v) => mapGqlVariant(v))
    .filter((v): v is ShopifyVariantHit => Boolean(v))

  const prices = variants
    .map((v) => Number(v.price))
    .filter((n) => Number.isFinite(n))
  const defaultVariant =
    variants.find((v) => v.available) ?? variants[0] ?? null

  const productUrl = productPageUrl(primaryDomain, handle)
  return {
    id: node.id,
    handle,
    title,
    description: (node.description || '').trim(),
    imageUrl: node.featuredImage?.url?.trim() || null,
    productUrl,
    cartUrl: defaultVariant
      ? cartPermalink(primaryDomain, defaultVariant.variantId)
      : null,
    checkoutUrl: defaultVariant
      ? checkoutPermalink(primaryDomain, defaultVariant.variantId)
      : null,
    priceMin: prices.length ? String(Math.min(...prices)) : null,
    priceMax: prices.length ? String(Math.max(...prices)) : null,
    currency,
    variants,
  }
}

function mapGqlVariant(v: ShopifyGqlVariant): ShopifyVariantHit | null {
  const variantId = v.legacyResourceId != null ? String(v.legacyResourceId) : ''
  if (!variantId && !v.id) return null
  return {
    id: v.id || variantId,
    variantId: variantId || numericIdFromGid(v.id || ''),
    title: (v.title || '').trim() || 'Default',
    sku: v.sku?.trim() || null,
    price: v.price != null ? String(v.price) : null,
    compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : null,
    available: v.availableForSale !== false,
    options: (v.selectedOptions ?? [])
      .filter((o) => o?.name && o?.value)
      .map((o) => ({ name: o.name!, value: o.value! })),
  }
}

export function numericIdFromGid(gid: string): string {
  const parts = gid.split('/')
  return parts[parts.length - 1] || ''
}

export function toProductGid(idOrGid: string): string {
  const raw = idOrGid.trim()
  if (raw.startsWith('gid://')) return raw
  if (/^\d+$/.test(raw)) return `gid://shopify/Product/${raw}`
  return raw
}

export function excerpt(text: string, max = 280): string | null {
  const t = text.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}
