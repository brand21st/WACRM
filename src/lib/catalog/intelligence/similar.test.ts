import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from '../core/types'
import { createCatalogMemoryDb } from '../search/memory-db'
import { intelSeed } from './facts.test'
import {
  findAlternativeProducts,
  findSimilarProducts,
  isModestStepUp,
  scoreProduct,
} from './similar'

function product(overrides: Partial<CatalogProduct> = {}): CatalogProduct {
  return {
    id: 'seed',
    accountId: 'acct-a',
    handle: 'seed',
    title: 'Seed',
    description: '',
    status: 'active',
    brand: 'Maison',
    productUrl: null,
    currency: 'INR',
    priceMin: 50,
    priceMax: 50,
    origin: 'wacrm',
    locked: false,
    publishedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    variants: [
      {
        id: 'v1',
        accountId: 'acct-a',
        productId: 'seed',
        title: 'M',
        sku: 'S',
        price: 50,
        compareAtPrice: null,
        currency: 'INR',
        available: true,
        inventoryQuantity: 1,
        options: [{ name: 'Size', value: 'M' }],
        sortOrder: 0,
        retailerId: 'S',
      },
    ],
    media: [],
    externalIds: [],
    collections: [{ id: 'col-bags', accountId: 'acct-a', handle: 'bags', title: 'Bags', status: 'active' }],
    attributes: [
      {
        id: 'av',
        accountId: 'acct-a',
        productId: 'seed',
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

describe('scoreProduct', () => {
  it('scores collection, options, attributes, and price band', () => {
    const ranked = scoreProduct(
      product(),
      product({
        id: 'other',
        brand: 'Maison',
        priceMin: 55,
        collections: [{ id: 'col-bags', accountId: 'acct-a', handle: 'bags', title: 'Bags', status: 'active' }],
      }),
      { shopName: 'Acme' },
    )
    expect(ranked.reasons).toEqual(
      expect.arrayContaining(['same_collection', 'same_options', 'same_attribute', 'price_band', 'same_brand']),
    )
    expect(ranked.score).toBeGreaterThan(0)
  })

  it('ignores brand when it equals the shop name', () => {
    const ranked = scoreProduct(
      product({ brand: 'Acme' }),
      product({ id: 'other', brand: 'Acme', collections: [], attributes: [], variants: [] }),
      { shopName: 'Acme' },
    )
    expect(ranked.reasons).not.toContain('same_brand')
  })

  it('boosts explicit similar relations', () => {
    const ranked = scoreProduct(product(), product({ id: 'p-gold', collections: [], attributes: [], variants: [] }), {
      relatedIds: new Set(['p-gold']),
      intent: 'similar',
    })
    expect(ranked.reasons).toContain('relation_similar')
  })
})

describe('findSimilarProducts', () => {
  it('ranks same-collection leather bags and drops out-of-stock', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const seed = (await findSimilarProducts(db, {
      accountId: 'acct-a',
      seed: product({ id: 'p-red', priceMin: 49, brand: 'Acme' }),
      shopName: 'Acme',
      limit: 10,
    }))
    const ids = seed.map((row) => row.product.id)
    expect(ids).toContain('p-navy')
    expect(ids).not.toContain('p-red')
    expect(ids).not.toContain('p-oos')
    expect(ids).not.toContain('p-b')
    const navy = seed.find((row) => row.product.id === 'p-navy')
    expect(navy?.reasons).toEqual(
      expect.arrayContaining(['same_collection', 'same_options', 'same_attribute']),
    )
  })

  it('does not leak another account’s catalog', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const rows = await findSimilarProducts(db, {
      accountId: 'acct-b',
      seed: product({ id: 'p-b', accountId: 'acct-b' }),
      limit: 10,
    })
    expect(rows.every((row) => row.product.accountId === 'acct-b')).toBe(true)
    expect(rows.map((row) => row.product.id)).not.toContain('p-red')
  })
})

describe('findAlternativeProducts', () => {
  it('returns cheaper products under the seed price', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const rows = await findAlternativeProducts(db, {
      accountId: 'acct-a',
      seed: product({ id: 'p-red', priceMin: 49 }),
      intent: 'cheaper',
      limit: 10,
    })
    expect(rows.map((row) => row.product.id)).toContain('p-cheap')
    expect(rows.every((row) => (row.product.priceMax ?? 0) < 49)).toBe(true)
  })

  it('respects an explicit budget and returns none over it', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const rows = await findAlternativeProducts(db, {
      accountId: 'acct-a',
      seed: product({ id: 'p-gold', priceMin: 80 }),
      intent: 'alternative',
      requirements: { maxPrice: 30 },
      limit: 10,
    })
    expect(rows.map((row) => row.product.id)).toEqual(['p-cheap'])
  })

  it('keeps modest step-up products for upsell', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const rows = await findAlternativeProducts(db, {
      accountId: 'acct-a',
      seed: product({ id: 'p-red', priceMin: 49 }),
      intent: 'upsell',
      limit: 10,
    })
    expect(rows.map((row) => row.product.id)).toEqual(expect.arrayContaining(['p-navy', 'p-gold']))
    expect(rows.every((row) => isModestStepUp(49, row.product.priceMin))).toBe(true)
  })
})

describe('isModestStepUp', () => {
  it('allows 1.5x or +800', () => {
    expect(isModestStepUp(100, 150)).toBe(true)
    expect(isModestStepUp(100, 900)).toBe(true)
    expect(isModestStepUp(100, 901)).toBe(false)
    expect(isModestStepUp(2000, 2700)).toBe(true)
    expect(isModestStepUp(100, 100)).toBe(false)
  })
})
