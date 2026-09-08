import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { attachCatalogFacts, loadCatalogFacts } from './facts'

export function intelProduct(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'p-red',
    account_id: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote',
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

export function intelVariant(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'v-red',
    account_id: 'acct-a',
    product_id: 'p-red',
    title: 'Red / M',
    sku: 'BAG-RED',
    price: 49,
    compare_at_price: 69,
    currency: 'INR',
    available: true,
    inventory_quantity: 3,
    options: [
      { name: 'Color', value: 'Red' },
      { name: 'Size', value: 'M' },
    ],
    sort_order: 0,
    retailer_id: 'BAG-RED',
    ...overrides,
  }
}

export function intelSeed() {
  return {
    catalog_products: [
      intelProduct(),
      intelProduct({
        id: 'p-navy',
        handle: 'navy-bag',
        title: 'Navy Bag',
        description: 'Leather backpack',
        price_min: 55,
        price_max: 55,
      }),
      intelProduct({
        id: 'p-gold',
        handle: 'gold-bag',
        title: 'Gold Bag',
        description: 'Evening clutch',
        brand: 'Maison',
        price_min: 80,
        price_max: 80,
      }),
      intelProduct({
        id: 'p-cheap',
        handle: 'canvas-tote',
        title: 'Canvas Tote',
        description: 'Everyday tote',
        brand: 'Acme',
        price_min: 29,
        price_max: 29,
      }),
      intelProduct({
        id: 'p-oos',
        handle: 'sold-out-bag',
        title: 'Sold Out Bag',
        description: 'Unavailable',
        price_min: 50,
        price_max: 50,
      }),
      intelProduct({
        id: 'p-b',
        account_id: 'acct-b',
        handle: 'other-red-bag',
        title: 'Other Shop Red Bag',
        price_min: 40,
        price_max: 40,
      }),
    ],
    catalog_variants: [
      intelVariant(),
      intelVariant({
        id: 'v-navy',
        product_id: 'p-navy',
        title: 'Navy / M',
        sku: 'BAG-NAVY',
        price: 55,
        compare_at_price: null,
        options: [
          { name: 'Color', value: 'Navy' },
          { name: 'Size', value: 'M' },
        ],
        retailer_id: 'BAG-NAVY',
      }),
      intelVariant({
        id: 'v-gold',
        product_id: 'p-gold',
        title: 'Gold',
        sku: 'BAG-GOLD',
        price: 80,
        compare_at_price: null,
        options: [{ name: 'Color', value: 'Gold' }],
        retailer_id: 'BAG-GOLD',
      }),
      intelVariant({
        id: 'v-cheap',
        product_id: 'p-cheap',
        title: 'Canvas',
        sku: 'TOTE-1',
        price: 29,
        compare_at_price: null,
        options: [{ name: 'Color', value: 'Beige' }],
        retailer_id: 'TOTE-1',
      }),
      intelVariant({
        id: 'v-oos',
        product_id: 'p-oos',
        title: 'Sold Out',
        sku: 'BAG-OOS',
        price: 50,
        available: false,
        inventory_quantity: 0,
        options: [{ name: 'Color', value: 'Red' }],
        retailer_id: 'BAG-OOS',
      }),
      intelVariant({
        id: 'v-b',
        account_id: 'acct-b',
        product_id: 'p-b',
        sku: 'OTHER-RED',
        retailer_id: 'OTHER-RED',
      }),
    ],
    catalog_media: [
      {
        id: 'm-red',
        account_id: 'acct-a',
        product_id: 'p-red',
        url: 'https://cdn.example/red.jpg',
        alt: 'Red bag',
        role: 'hero',
        sort_order: 0,
      },
    ],
    catalog_external_ids: [],
    catalog_collections: [
      { id: 'col-bags', account_id: 'acct-a', handle: 'bags', title: 'Bags', status: 'active' },
    ],
    catalog_product_collections: [
      { account_id: 'acct-a', product_id: 'p-red', collection_id: 'col-bags' },
      { account_id: 'acct-a', product_id: 'p-navy', collection_id: 'col-bags' },
    ],
    catalog_attributes: [
      { id: 'a-mat', account_id: 'acct-a', key: 'material', label: 'Material' },
    ],
    catalog_attribute_values: [
      {
        id: 'av-red',
        account_id: 'acct-a',
        product_id: 'p-red',
        variant_id: 'v-red',
        attribute_id: 'a-mat',
        value: 'leather',
      },
      {
        id: 'av-navy',
        account_id: 'acct-a',
        product_id: 'p-navy',
        variant_id: 'v-navy',
        attribute_id: 'a-mat',
        value: 'leather',
      },
    ],
    catalog_product_relations: [
      {
        account_id: 'acct-a',
        product_id: 'p-red',
        related_product_id: 'p-gold',
        kind: 'similar',
        sort_order: 0,
      },
      {
        account_id: 'acct-a',
        product_id: 'p-red',
        related_product_id: 'p-cheap',
        kind: 'cross_sell',
        sort_order: 1,
      },
    ],
  }
}

describe('loadCatalogFacts', () => {
  it('batch-loads collections, attributes, and relations', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const facts = await loadCatalogFacts(db, 'acct-a', ['p-red', 'p-navy'])
    expect(facts.collections.get('p-red')?.map((col) => col.title)).toEqual(['Bags'])
    expect(facts.attributes.get('p-red')?.[0]).toMatchObject({
      key: 'material',
      label: 'Material',
      value: 'leather',
    })
    expect(facts.relations.get('p-red')?.map((row) => row.kind)).toEqual([
      'similar',
      'cross_sell',
    ])
    expect(facts.collections.get('p-navy')?.[0]?.id).toBe('col-bags')
  })

  it('does not attach another account’s facts', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const facts = await loadCatalogFacts(db, 'acct-b', ['p-red'])
    expect(facts.attributes.get('p-red')).toBeUndefined()
    expect(facts.relations.get('p-red')).toBeUndefined()
  })

  it('attaches facts onto hydrated products', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const [product] = await attachCatalogFacts(db, 'acct-a', [
      {
        id: 'p-red',
        accountId: 'acct-a',
        handle: 'red-bag',
        title: 'Red Bag',
        description: '',
        status: 'active',
        brand: 'Acme',
        productUrl: null,
        currency: 'INR',
        priceMin: 49,
        priceMax: 49,
        origin: 'wacrm',
        locked: false,
        publishedAt: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        variants: [],
        media: [],
        externalIds: [],
      },
    ])
    expect(product.attributes?.[0]?.value).toBe('leather')
    expect(product.collections?.[0]?.handle).toBe('bags')
  })
})
