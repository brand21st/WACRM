import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from '../core/types'
import {
  CATALOG_EMBEDDING_DIMENSIONS,
  CATALOG_EMBEDDING_MODEL,
  buildCatalogEmbedDocument,
  hashCatalogEmbedDocument,
} from './embed-document'

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'p-red',
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    variants: [
      {
        id: 'v-red',
        accountId: 'acct-a',
        productId: 'p-red',
        title: 'Red / M',
        sku: 'BAG-RED',
        price: 49,
        compareAtPrice: 69,
        currency: 'INR',
        available: true,
        inventoryQuantity: 3,
        options: [
          { name: 'Color', value: 'Red' },
          { name: 'Size', value: 'M' },
        ],
        sortOrder: 0,
        retailerId: 'BAG-RED',
      },
    ],
    media: [],
    externalIds: [],
    collections: [
      {
        id: 'col-bags',
        accountId: 'acct-a',
        handle: 'bags',
        title: 'Bags',
        status: 'active',
      },
    ],
    attributes: [
      {
        id: 'av-1',
        accountId: 'acct-a',
        productId: 'p-red',
        variantId: null,
        attributeId: 'a-mat',
        key: 'material',
        label: 'Material',
        value: 'leather',
      },
    ],
    ...overrides,
  }
}

describe('buildCatalogEmbedDocument', () => {
  it('includes title, description, brand, collections, attributes, and options', () => {
    const doc = buildCatalogEmbedDocument(product())
    expect(doc).toContain('Red Bag')
    expect(doc).toContain('Leather tote')
    expect(doc).toContain('brand: Acme')
    expect(doc).toContain('collections: Bags')
    expect(doc).toContain('material=leather')
    expect(doc).toContain('Color=Red')
    expect(doc).toContain('Size=M')
    expect(doc).not.toContain('49')
    expect(doc).not.toContain('BAG-RED')
    expect(doc).not.toContain('p-red')
  })

  it('omits brand when it equals the shop name', () => {
    const doc = buildCatalogEmbedDocument(product({ brand: 'Lumin Store' }), 'Lumin Store')
    expect(doc).not.toContain('brand:')
  })

  it('hashes the document stably', () => {
    const a = hashCatalogEmbedDocument(buildCatalogEmbedDocument(product()))
    const b = hashCatalogEmbedDocument(buildCatalogEmbedDocument(product()))
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
    expect(CATALOG_EMBEDDING_MODEL).toBe('text-embedding-3-small')
    expect(CATALOG_EMBEDDING_DIMENSIONS).toBe(1536)
  })
})
