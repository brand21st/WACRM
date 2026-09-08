import { describe, expect, it } from 'vitest'
import { toCard } from '@/lib/shopify/tools'
import type { CatalogProduct } from '../core/types'
import { catalogProductToHit } from './map-hit'

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'cat-1',
    accountId: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote',
    status: 'active',
    brand: 'Acme',
    productUrl: null,
    currency: 'INR',
    priceMin: 49,
    priceMax: 59,
    origin: 'wacrm',
    locked: false,
    publishedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    variants: [
      {
        id: 'var-1',
        accountId: 'acct-a',
        productId: 'cat-1',
        title: 'Default',
        sku: 'BAG-RED',
        price: 49,
        compareAtPrice: 59,
        currency: 'INR',
        available: true,
        inventoryQuantity: 2,
        options: [{ name: 'Color', value: 'Red' }],
        sortOrder: 0,
        retailerId: 'BAG-RED',
      },
    ],
    media: [
      {
        id: 'm2',
        accountId: 'acct-a',
        productId: 'cat-1',
        url: 'https://cdn.example/side.jpg',
        alt: 'Side',
        role: 'listing',
        sortOrder: 1,
      },
      {
        id: 'm1',
        accountId: 'acct-a',
        productId: 'cat-1',
        url: 'https://cdn.example/hero.jpg',
        alt: 'Hero',
        role: 'hero',
        sortOrder: 0,
      },
    ],
    externalIds: [
      {
        id: 'e1',
        accountId: 'acct-a',
        productId: 'cat-1',
        variantId: null,
        source: 'shopify',
        entity: 'product',
        externalId: 'gid://shopify/Product/42',
      },
      {
        id: 'e2',
        accountId: 'acct-a',
        productId: 'cat-1',
        variantId: 'var-1',
        source: 'shopify',
        entity: 'variant',
        externalId: '99',
      },
    ],
    ...overrides,
  }
}

describe('catalogProductToHit', () => {
  it('maps Shopify ids, media, permalinks, and persisted retailer ids', () => {
    const hit = catalogProductToHit(product(), {
      primaryDomain: 'https://shop.example',
      currency: 'INR',
    })
    expect(hit.id).toBe('gid://shopify/Product/42')
    expect(hit.catalogId).toBe('cat-1')
    expect(hit.brand).toBe('Acme')
    expect(hit.imageUrl).toBe('https://cdn.example/hero.jpg')
    expect(hit.imageUrls).toEqual([
      'https://cdn.example/hero.jpg',
      'https://cdn.example/side.jpg',
    ])
    expect(hit.productUrl).toBe('https://shop.example/products/red-bag')
    expect(hit.cartUrl).toBe('https://shop.example/cart/99:1')
    expect(hit.checkoutUrl).toBe('https://shop.example/cart/99:1?checkout')
    expect(hit.variants[0]?.variantId).toBe('99')
    expect(hit.variants[0]?.retailerId).toBe('BAG-RED')
    expect(toCard(hit).retailerId).toBe('BAG-RED')
  })

  it('omits cart permalinks for WACRM-only products', () => {
    const hit = catalogProductToHit(
      product({
        externalIds: [],
        productUrl: 'https://wacrm.example/p/red-bag',
      }),
    )
    expect(hit.id).toBe('cat-1')
    expect(hit.cartUrl).toBeNull()
    expect(hit.checkoutUrl).toBeNull()
    expect(hit.productUrl).toBe('https://wacrm.example/p/red-bag')
    expect(toCard(hit).retailerId).toBe('BAG-RED')
  })
})
