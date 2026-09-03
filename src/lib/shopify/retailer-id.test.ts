import { describe, expect, it } from 'vitest'
import {
  facebookShopifyRetailerId,
  findVariantByRetailerId,
  parseFacebookShopifyRetailerId,
  parseRetailerIdSource,
  retailerIdForVariant,
} from './retailer-id'
import type { ShopifyVariantHit } from './types'

const variant: ShopifyVariantHit = {
  id: 'gid://shopify/ProductVariant/9',
  variantId: '99',
  title: 'Default',
  sku: 'BAG-RED',
  price: '49.00',
  compareAtPrice: null,
  available: true,
  options: [],
}

describe('retailer-id', () => {
  it('defaults unknown sources to sku', () => {
    expect(parseRetailerIdSource('nope')).toBe('sku')
    expect(parseRetailerIdSource('variant_id')).toBe('variant_id')
  })

  it('uses sku, then variant id, then facebook shopify pattern', () => {
    expect(retailerIdForVariant(variant, 'sku', '42')).toBe('BAG-RED')
    expect(retailerIdForVariant(variant, 'variant_id', '42')).toBe('99')
    expect(retailerIdForVariant(variant, 'facebook_shopify', '42')).toBe(
      'shopify_IN_42_99',
    )
  })

  it('parses Facebook Shopify retailer ids', () => {
    expect(parseFacebookShopifyRetailerId('shopify_IN_42_99')).toEqual({
      productId: '42',
      variantId: '99',
    })
    expect(facebookShopifyRetailerId('gid://shopify/Product/42', '99')).toBe(
      'shopify_IN_42_99',
    )
  })

  it('maps inbound retailer ids back to variants', () => {
    const products = [
      {
        shopify_product_id: 'gid://shopify/Product/42',
        variants: [variant],
      },
    ]
    expect(findVariantByRetailerId(products, 'BAG-RED', 'sku')?.variant.variantId).toBe(
      '99',
    )
    expect(
      findVariantByRetailerId(products, 'shopify_IN_42_99', 'facebook_shopify')
        ?.variant.sku,
    ).toBe('BAG-RED')
  })
})
