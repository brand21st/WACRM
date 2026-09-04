import type { RetailerIdSource } from '@/lib/shopify/retailer-id'

export interface CommerceBeneficiary {
  name: string
  address_line1: string
  address_line2?: string
  city: string
  state: string
  country: string
  postal_code: string
  email?: string
}

export interface CommerceSettings {
  metaCatalogId: string | null
  metaCatalogAutoSync: boolean
  lastMetaCatalogSyncAt: string | null
  metaCatalogItemCount: number
  retailerIdSource: RetailerIdSource
  waPaymentConfigurationName: string | null
  razorpayKeyId: string | null
  hasRazorpaySecret: boolean
  hasRazorpayWebhookSecret: boolean
  shipBeneficiary: CommerceBeneficiary | null
}

export interface CommerceSecrets {
  razorpayKeyId: string | null
  razorpayKeySecret: string | null
  razorpayWebhookSecret: string | null
}

export interface InboundCartItem {
  product_retailer_id: string
  quantity: number
  item_price?: number
  currency?: string
  name?: string
}

export type CommerceOrderStatus =
  | 'pending'
  | 'processing'
  | 'partially_shipped'
  | 'shipped'
  | 'completed'
  | 'canceled'

export interface MappedCartLine {
  retailer_id: string
  name: string
  quantity: number
  amountPaise: number
  variantId: string
  productId: string
  sku: string | null
}

export function nativeCommerceEnabled(settings: {
  metaCatalogId?: string | null
  waPaymentConfigurationName?: string | null
}): boolean {
  return Boolean(
    settings.metaCatalogId?.trim() && settings.waPaymentConfigurationName?.trim(),
  )
}
