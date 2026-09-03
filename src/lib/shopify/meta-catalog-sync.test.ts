import { describe, expect, it } from 'vitest'
import {
  catalogIdLooksLikeWhatsAppAsset,
  catalogItemsFromProduct,
  explainMetaCatalogSyncError,
} from './meta-catalog-sync'
import type { ShopifyProductHit } from './types'

const product: ShopifyProductHit = {
  id: 'gid://shopify/Product/42',
  handle: 'red-bag',
  title: 'Red Bag',
  description: 'Leather tote',
  imageUrl: 'https://cdn.example/bag.jpg',
  productUrl: 'https://shop.example/products/red-bag',
  cartUrl: null,
  checkoutUrl: null,
  priceMin: '49.00',
  priceMax: '49.00',
  currency: 'INR',
  variants: [
    {
      id: 'gid://shopify/ProductVariant/9',
      variantId: '99',
      title: 'Default',
      sku: 'BAG-RED',
      price: '49.00',
      compareAtPrice: null,
      available: true,
      options: [],
    },
  ],
}

describe('catalogItemsFromProduct', () => {
  it('maps Shopify variants to Meta catalog items with major-unit prices', () => {
    const items = catalogItemsFromProduct(product, 'sku', 'Acme')
    expect(items).toEqual([
      expect.objectContaining({
        retailer_id: 'BAG-RED',
        name: 'Red Bag',
        availability: 'in stock',
        price: 49,
        currency: 'INR',
        url: 'https://shop.example/products/red-bag',
        brand: 'Acme',
      }),
    ])
  })
})

describe('catalogIdLooksLikeWhatsAppAsset', () => {
  it('rejects a pasted phone number id or WABA id', () => {
    expect(
      catalogIdLooksLikeWhatsAppAsset('1273107552556381', '1273107552556381', '1754381179136878'),
    ).toMatch(/Phone Number ID/)
    expect(
      catalogIdLooksLikeWhatsAppAsset('1754381179136878', '1273107552556381', '1754381179136878'),
    ).toMatch(/Business Account ID/)
    expect(
      catalogIdLooksLikeWhatsAppAsset('999', '1273107552556381', '1754381179136878'),
    ).toBeNull()
  })
})

describe('explainMetaCatalogSyncError', () => {
  it('rewrites Graph object-not-found errors with Commerce Manager guidance', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage:
        "Unsupported post request. Object with ID '1537621380970509' does not exist, cannot be loaded due to missing permissions, or does not support this operation.",
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      connected: { status: 'ok', catalogs: [{ id: '111222333', name: 'Store catalog' }] },
    })
    expect(message).toMatch(/Commerce Manager/)
    expect(message).toMatch(/catalog_management/)
    expect(message).toMatch(/111222333/)
    expect(message).not.toMatch(/Unsupported post request/)
  })

  it('blames the missing catalog_management scope, not the catalog', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage: '(#100) Missing Permission',
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      // The probe is blocked by the very same missing scope.
      connected: {
        status: 'unavailable',
        reason:
          '(#100) This application has not been approved to use this api. Please check the application capabilities or access token permissions.',
      },
    })
    expect(message).toMatch(/catalog_management/)
    expect(message).toMatch(/System users/)
    expect(message).not.toMatch(/No product catalog is connected/)
  })

  it('does not claim a catalog is missing when the check itself failed', () => {
    const message = explainMetaCatalogSyncError({
      catalogId: '1537621380970509',
      graphMessage: 'Temporary Graph outage',
      phoneNumberId: '1273107552556381',
      wabaId: '1754381179136878',
      connected: { status: 'unavailable', reason: 'Graph returned 500.' },
    })
    expect(message).toMatch(/Could not check which catalogs are connected/)
    expect(message).not.toMatch(/No product catalog is connected/)
  })
})
