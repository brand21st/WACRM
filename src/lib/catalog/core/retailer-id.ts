import {
  parseRetailerIdSource,
  retailerIdForVariant,
  type RetailerIdSource,
} from '@/lib/shopify/retailer-id'

export { parseRetailerIdSource, type RetailerIdSource }

/**
 * Persistable retailer_id for a catalog variant.
 * Delegates to the existing Shopify helper so Meta / WhatsApp cart
 * identities stay stable. Do not fork the algorithm.
 */
export function catalogRetailerIdForVariant(
  variant: { sku?: string | null; variantId: string },
  source: RetailerIdSource,
  productId?: string | null,
): string {
  return retailerIdForVariant(
    { sku: variant.sku ?? null, variantId: variant.variantId },
    source,
    productId,
  )
}
