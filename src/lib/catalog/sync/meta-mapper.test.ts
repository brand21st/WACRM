import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from '@/lib/catalog/core/types'
import { catalogItemsFromCatalogProduct } from './meta-mapper'

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'prod-1',
    accountId: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote',
    status: 'active',
    brand: 'Acme',
    productUrl: 'https://shop.example/products/red-bag',
    currency: 'INR',
    priceMin: 49,
    priceMax: 49,
    origin: 'wacrm',
    locked: false,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    variants: [
      {
        id: 'var-1',
        accountId: 'acct-a',
        productId: 'prod-1',
        title: 'Default',
        sku: 'BAG-RED',
        price: 49,
        compareAtPrice: null,
        currency: 'INR',
        available: true,
        inventoryQuantity: 3,
        options: [],
        sortOrder: 0,
        retailerId: 'BAG-RED',
      },
    ],
    media: [
      {
        id: 'media-1',
        accountId: 'acct-a',
        productId: 'prod-1',
        url: 'https://cdn.example/bag.jpg',
        alt: null,
        role: 'hero',
        sortOrder: 0,
      },
    ],
    externalIds: [],
    ...overrides,
  }
}

describe('catalogItemsFromCatalogProduct', () => {
  it('maps persisted retailer_id, price, availability, hero media, and brand', () => {
    const items = catalogItemsFromCatalogProduct(product())
    expect(items).toEqual([
      expect.objectContaining({
        retailer_id: 'BAG-RED',
        name: 'Red Bag',
        description: 'Leather tote',
        availability: 'in stock',
        price: 49,
        currency: 'INR',
        url: 'https://shop.example/products/red-bag',
        image_url: 'https://cdn.example/bag.jpg',
        brand: 'Acme',
      }),
    ])
  })

  it('uses persisted retailer_id even when it does not match SKU', () => {
    const items = catalogItemsFromCatalogProduct(
      product({
        variants: [
          {
            id: 'var-1',
            accountId: 'acct-a',
            productId: 'prod-1',
            title: 'Default',
            sku: 'BAG-RED',
            price: 49,
            compareAtPrice: null,
            currency: 'INR',
            available: false,
            inventoryQuantity: 0,
            options: [],
            sortOrder: 0,
            retailerId: 'facebook_shopify_99',
          },
        ],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.retailer_id).toBe('facebook_shopify_99')
    expect(items[0]?.availability).toBe('out of stock')
  })

  it('skips empty retailer_id and includes variant title in the name', () => {
    const items = catalogItemsFromCatalogProduct(
      product({
        variants: [
          {
            id: 'var-1',
            accountId: 'acct-a',
            productId: 'prod-1',
            title: 'Large',
            sku: 'BAG-L',
            price: 59,
            compareAtPrice: null,
            currency: 'INR',
            available: true,
            inventoryQuantity: 1,
            options: [],
            sortOrder: 0,
            retailerId: 'BAG-L',
          },
          {
            id: 'var-2',
            accountId: 'acct-a',
            productId: 'prod-1',
            title: 'Skip',
            sku: 'NO-ID',
            price: 10,
            compareAtPrice: null,
            currency: 'INR',
            available: true,
            inventoryQuantity: 1,
            options: [],
            sortOrder: 1,
            retailerId: '   ',
          },
        ],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.name).toBe('Red Bag — Large')
  })
})
