import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from '../core/types'
import { createCatalogMemoryDb } from './memory-db'
import {
  catalogSearchFetchLimit,
  listNewArrivalsCatalog,
  sanitizeFtsQuery,
  searchCatalog,
} from './query'

function product(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'p-red',
    account_id: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote for everyday',
    status: 'active',
    brand: 'Acme',
    product_url: 'https://shop.example/products/red-bag',
    currency: 'INR',
    price_min: 49,
    price_max: 49,
    origin: 'wacrm',
    locked: false,
    published_at: '2026-09-01T00:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...overrides,
  }
}

function variant(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'v-red',
    account_id: 'acct-a',
    product_id: 'p-red',
    title: 'Medium',
    sku: 'BAG-RED',
    price: 49,
    compare_at_price: null,
    currency: 'INR',
    available: true,
    inventory_quantity: 3,
    options: [{ name: 'Size', value: 'M' }],
    sort_order: 0,
    retailer_id: 'BAG-RED',
    ...overrides,
  }
}

function media(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'm-red',
    account_id: 'acct-a',
    product_id: 'p-red',
    url: 'https://cdn.example/red.jpg',
    alt: 'Red bag',
    role: 'hero',
    sort_order: 0,
    ...overrides,
  }
}

describe('catalog search helpers', () => {
  it('caps the hydrate fetch window', () => {
    expect(catalogSearchFetchLimit(1)).toBe(3)
    expect(catalogSearchFetchLimit(10)).toBe(30)
    expect(catalogSearchFetchLimit(50)).toBe(50)
    expect(catalogSearchFetchLimit(200)).toBe(50)
  })

  it('strips FTS operators', () => {
    expect(sanitizeFtsQuery('red & (bag)!')).toBe('red bag')
  })
})

describe('searchCatalog', () => {
  const seed = {
    catalog_products: [
      product(),
      product({
        id: 'p-blue',
        handle: 'blue-sneakers',
        title: 'Blue Sneakers',
        description: 'Canvas runners',
        brand: 'Stride',
        price_min: 80,
        price_max: 90,
        published_at: '2026-09-06T00:00:00.000Z',
        created_at: '2026-09-05T00:00:00.000Z',
      }),
      product({
        id: 'p-draft',
        handle: 'secret-draft',
        title: 'Draft Coat',
        description: 'Not listed',
        status: 'draft',
        published_at: '2026-09-07T00:00:00.000Z',
      }),
      product({
        id: 'p-b',
        account_id: 'acct-b',
        handle: 'red-bag',
        title: 'Other Shop Red Bag',
      }),
    ],
    catalog_variants: [
      variant(),
      variant({
        id: 'v-blue',
        product_id: 'p-blue',
        title: 'Blue / 8',
        sku: 'SNK-BLU',
        price: 80,
        options: [{ name: 'Color', value: 'Blue' }],
        retailer_id: 'SNK-BLU',
      }),
      variant({
        id: 'v-draft',
        product_id: 'p-draft',
        sku: 'DRAFT-1',
        retailer_id: 'DRAFT-1',
      }),
      variant({
        id: 'v-b',
        account_id: 'acct-b',
        product_id: 'p-b',
        sku: 'OTHER-RED',
        retailer_id: 'OTHER-RED',
      }),
    ],
    catalog_media: [
      media(),
      media({ id: 'm-blue', product_id: 'p-blue', url: 'https://cdn.example/blue.jpg' }),
    ],
    catalog_external_ids: [],
    catalog_collections: [
      { id: 'col-1', account_id: 'acct-a', handle: 'mens', title: 'Men', status: 'active' },
    ],
    catalog_product_collections: [
      { account_id: 'acct-a', product_id: 'p-blue', collection_id: 'col-1' },
    ],
    catalog_attributes: [
      { id: 'a-1', account_id: 'acct-a', key: 'material', label: 'Material' },
    ],
    catalog_attribute_values: [
      {
        id: 'av-1',
        account_id: 'acct-a',
        product_id: 'p-red',
        variant_id: 'v-red',
        attribute_id: 'a-1',
        value: 'leather',
      },
    ],
  }

  it('finds title, brand, SKU, and handle matches and excludes drafts and other accounts', async () => {
    const db = createCatalogMemoryDb(seed)
    const byTitle = await searchCatalog(db, { accountId: 'acct-a', text: 'red bag' })
    expect(byTitle.map((p) => p.id)).toEqual(['p-red'])
    expect(byTitle[0]?.variants[0]?.sku).toBe('BAG-RED')

    const byBrand = await searchCatalog(db, { accountId: 'acct-a', text: 'Stride' })
    expect(byBrand.map((p) => p.handle)).toEqual(['blue-sneakers'])

    const bySku = await searchCatalog(db, { accountId: 'acct-a', text: 'BAG-RED' })
    expect(bySku.map((p) => p.id)).toEqual(['p-red'])

    const byHandle = await searchCatalog(db, { accountId: 'acct-a', text: 'blue-sneakers' })
    expect(byHandle.map((p) => p.id)).toEqual(['p-blue'])

    const drafts = await searchCatalog(db, { accountId: 'acct-a', text: 'Draft Coat' })
    expect(drafts).toEqual([])
  })

  it('filters by price, availability, option, attribute, and collection', async () => {
    const db = createCatalogMemoryDb(seed)
    const priced = await searchCatalog(db, {
      accountId: 'acct-a',
      priceMax: 60,
      sort: 'newest',
    })
    expect(priced.map((p) => p.id)).toEqual(['p-red'])

    const oos = createCatalogMemoryDb({
      ...seed,
      catalog_variants: seed.catalog_variants.map((row) =>
        row.product_id === 'p-red' ? { ...row, available: false } : row,
      ),
    })
    const inStock = await searchCatalog(oos, { accountId: 'acct-a', inStock: true })
    expect(inStock.map((p) => p.id)).toEqual(['p-blue'])

    const sized = await searchCatalog(db, {
      accountId: 'acct-a',
      option: { name: 'Size', value: 'M' },
    })
    expect(sized.map((p) => p.id)).toEqual(['p-red'])

    const leather = await searchCatalog(db, {
      accountId: 'acct-a',
      attribute: { key: 'material', value: 'leather' },
    })
    expect(leather.map((p) => p.id)).toEqual(['p-red'])

    const mens = await searchCatalog(db, {
      accountId: 'acct-a',
      collectionHandle: 'mens',
    })
    expect(mens.map((p) => p.id)).toEqual(['p-blue'])

    const missing = await searchCatalog(db, {
      accountId: 'acct-a',
      collectionHandle: 'womens',
    })
    expect(missing).toEqual([])
  })

  it('sorts newest and by price', async () => {
    const db = createCatalogMemoryDb(seed)
    const newest = await listNewArrivalsCatalog(db, 'acct-a', 10)
    expect(newest.map((p: CatalogProduct) => p.id)).toEqual(['p-blue', 'p-red'])

    const cheap = await searchCatalog(db, { accountId: 'acct-a', sort: 'price_asc' })
    expect(cheap.map((p) => p.id)).toEqual(['p-red', 'p-blue'])
  })

  it('returns an empty list when the account catalog is empty', async () => {
    const db = createCatalogMemoryDb()
    expect(await searchCatalog(db, { accountId: 'acct-a', text: 'bag' })).toEqual([])
  })
})
