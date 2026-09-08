import { describe, expect, it } from 'vitest'
import { retailerIdForVariant } from '@/lib/shopify/retailer-id'
import { catalogRetailerIdForVariant, parseRetailerIdSource } from './retailer-id'

const variant = {
  sku: 'BAG-RED',
  variantId: '99',
}

describe('catalog retailer-id wrapper', () => {
  it('delegates to the existing retailerIdForVariant algorithm', () => {
    expect(catalogRetailerIdForVariant(variant, 'sku', '42')).toBe(
      retailerIdForVariant(variant, 'sku', '42'),
    )
    expect(catalogRetailerIdForVariant(variant, 'variant_id', '42')).toBe(
      retailerIdForVariant(variant, 'variant_id', '42'),
    )
    expect(catalogRetailerIdForVariant(variant, 'facebook_shopify', '42')).toBe(
      retailerIdForVariant(variant, 'facebook_shopify', '42'),
    )
  })

  it('uses sku, then variant id, then facebook shopify pattern', () => {
    expect(catalogRetailerIdForVariant(variant, 'sku', '42')).toBe('BAG-RED')
    expect(catalogRetailerIdForVariant({ sku: null, variantId: '99' }, 'sku', '42')).toBe(
      '99',
    )
    expect(catalogRetailerIdForVariant(variant, 'variant_id', '42')).toBe('99')
    expect(catalogRetailerIdForVariant(variant, 'facebook_shopify', '42')).toBe(
      'shopify_IN_42_99',
    )
  })

  it('reuses parseRetailerIdSource defaults', () => {
    expect(parseRetailerIdSource('nope')).toBe('sku')
    expect(parseRetailerIdSource('variant_id')).toBe('variant_id')
    expect(parseRetailerIdSource('facebook_shopify')).toBe('facebook_shopify')
  })
})
