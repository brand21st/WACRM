import { describe, expect, it } from 'vitest'
import type { CatalogProduct } from '../core/types'
import { createCatalogMemoryDb } from './memory-db'
import {
  catalogFtsAndQuery,
  catalogFtsOrQuery,
  catalogFtsRequiredQuery,
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

  it('builds AND then required then OR queries', () => {
    expect(catalogFtsAndQuery('toy camera')).toBe('toy camera')
    expect(catalogFtsRequiredQuery('toy camera')).toBe('camera')
    expect(catalogFtsOrQuery('toy camera')).toBe('toy OR camera')
    expect(catalogFtsAndQuery('I would like to know about the toy camera')).toBe(
      'toy camera',
    )
    expect(catalogFtsRequiredQuery('washup toy')).toBe('washup')
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

  it('finds a digital camera for toy camera and a wash-up set for washup', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        product({
          id: 'p-cam',
          handle: 'kids-digital-camera',
          title: 'Kids Digital Camera',
          description: 'HD photo and video camera for children',
        }),
        product({
          id: 'p-kitchen',
          handle: 'itoys-wash-up-kitchen-set',
          title: 'Itoys Wash Up Kitchen Set',
          description: 'Kitchen sink play set with running water',
        }),
        product({
          id: 'p-nail',
          handle: 'baby-electric-nail-trimmer',
          title: 'Baby Electric Nail Trimmer',
          description: 'Safe nail care kit',
          published_at: '2026-09-12T00:00:00.000Z',
        }),
        product({
          id: 'p-teddy',
          handle: 'breathing-teddy-bear',
          title: 'Breathing Teddy Bear Plush Toy',
          description: 'Surface-washable stuffed animal',
        }),
      ],
      catalog_variants: [
        variant({ id: 'v-cam', product_id: 'p-cam', sku: 'CAM-1', retailer_id: 'CAM-1' }),
        variant({
          id: 'v-kitchen',
          product_id: 'p-kitchen',
          sku: 'WASH-1',
          retailer_id: 'WASH-1',
        }),
        variant({ id: 'v-nail', product_id: 'p-nail', sku: 'NAIL-1', retailer_id: 'NAIL-1' }),
        variant({
          id: 'v-teddy',
          product_id: 'p-teddy',
          sku: 'TED-1',
          retailer_id: 'TED-1',
        }),
      ],
      catalog_media: [],
      catalog_external_ids: [],
      catalog_collections: [],
      catalog_product_collections: [],
      catalog_attributes: [],
      catalog_attribute_values: [],
    })

    const cameras = await searchCatalog(db, {
      accountId: 'acct-a',
      text: 'I would like to know about the toy camera',
    })
    expect(cameras.map((p) => p.id)[0]).toBe('p-cam')
    expect(cameras.map((p) => p.id)).not.toContain('p-nail')

    const washup = await searchCatalog(db, { accountId: 'acct-a', text: 'Washup toy' })
    expect(washup.map((p) => p.id)[0]).toBe('p-kitchen')
  })

  it('ranks title matches ahead of description noise and newest SKUs', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        ...Array.from({ length: 8 }, (_, i) =>
          product({
            id: `p-set-${i}`,
            handle: `dinner-set-${i}`,
            title: `Dinner Set ${i + 1}`,
            description: 'Table set for kids',
            published_at: `2026-09-1${i}T00:00:00.000Z`,
          }),
        ),
        product({
          id: 'p-cam',
          handle: 'kids-digital-camera',
          title: 'Kids Digital Camera',
          description: 'HD photo camera',
          published_at: '2026-01-01T00:00:00.000Z',
        }),
        product({
          id: 'p-tee',
          handle: 'cotton-t-shirt',
          title: 'Cotton T-Shirt',
          description: 'Everyday tee',
        }),
      ],
      catalog_variants: [
        ...Array.from({ length: 8 }, (_, i) =>
          variant({
            id: `v-set-${i}`,
            product_id: `p-set-${i}`,
            sku: `SET-${i}`,
            retailer_id: `SET-${i}`,
          }),
        ),
        variant({ id: 'v-cam', product_id: 'p-cam', sku: 'CAM-1', retailer_id: 'CAM-1' }),
        variant({ id: 'v-tee', product_id: 'p-tee', sku: 'TEE-1', retailer_id: 'TEE-1' }),
      ],
      catalog_media: [],
      catalog_external_ids: [],
      catalog_collections: [],
      catalog_product_collections: [],
      catalog_attributes: [],
      catalog_attribute_values: [],
    })

    const cameras = await searchCatalog(db, { accountId: 'acct-a', text: 'toy camera' })
    expect(cameras.map((p) => p.id)[0]).toBe('p-cam')

    const tees = await searchCatalog(db, { accountId: 'acct-a', text: 't-shirt' })
    expect(tees.map((p) => p.id)).toContain('p-tee')
  })
})
