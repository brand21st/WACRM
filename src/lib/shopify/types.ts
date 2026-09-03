import type { ShopifyCatalogVariant } from '@/types'

export interface ShopifyStoreConfig {
  accountId: string
  shopDomain: string
  accessToken: string
  isActive: boolean
  shopName: string | null
  primaryDomain: string | null
  currency: string | null
  metaCatalogId: string | null
  lastVerifiedAt: string | null
  lastCatalogSyncAt: string | null
  catalogProductCount: number
}

export interface ShopifyVariantHit {
  id: string
  variantId: string
  title: string
  sku: string | null
  price: string | null
  compareAtPrice: string | null
  available: boolean
  options: { name: string; value: string }[]
}

export interface ShopifyProductHit {
  id: string
  handle: string
  title: string
  description: string
  imageUrl: string | null
  /** Extra listing angles from Shopify `images` — used for vision confirm. */
  imageUrls?: string[]
  productUrl: string
  cartUrl: string | null
  checkoutUrl: string | null
  priceMin: string | null
  priceMax: string | null
  currency: string | null
  variants: ShopifyVariantHit[]
}

export interface ShopifyProductCard {
  title: string
  imageUrl: string | null
  productUrl: string
  cartUrl: string | null
  checkoutUrl: string | null
  inStock: boolean
  caption: string
  retailerId?: string | null
}

export interface ShopifyOrderHit {
  id: string
  name: string
  financialStatus: string | null
  fulfillmentStatus: string | null
  createdAt: string | null
  total: string | null
  currency: string | null
  lineItems: { title: string; quantity: number; sku: string | null; variantTitle: string | null }[]
  tracking: { number: string | null; url: string | null; company: string | null; status: string | null }[]
}

export type CatalogVariantSummary = ShopifyCatalogVariant
