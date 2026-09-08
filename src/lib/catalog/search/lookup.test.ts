import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from './memory-db'
import { lookupCatalogProduct } from './lookup'

const seed = {
  catalog_products: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      account_id: 'acct-a',
      handle: 'red-bag',
      title: 'Red Bag',
      description: 'Tote',
      status: 'active',
      brand: 'Acme',
      product_url: null,
      currency: 'INR',
      price_min: 49,
      price_max: 49,
      origin: 'shopify_import',
      locked: false,
      published_at: '2026-09-01T00:00:00.000Z',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-09-01T00:00:00.000Z',
    },
  ],
  catalog_variants: [
    {
      id: 'var-1',
      account_id: 'acct-a',
      product_id: '11111111-1111-4111-8111-111111111111',
      title: 'Default',
      sku: 'BAG-RED',
      price: 49,
      compare_at_price: null,
      currency: 'INR',
      available: true,
      inventory_quantity: 1,
      options: [],
      sort_order: 0,
      retailer_id: 'BAG-RED',
    },
  ],
  catalog_media: [],
  catalog_external_ids: [
    {
      id: 'e1',
      account_id: 'acct-a',
      product_id: '11111111-1111-4111-8111-111111111111',
      variant_id: null,
      source: 'shopify',
      entity: 'product',
      external_id: 'gid://shopify/Product/42',
    },
  ],
  catalog_collections: [],
  catalog_product_collections: [],
  catalog_attributes: [
    { id: 'a-1', account_id: 'acct-a', key: 'color', label: 'Color' },
  ],
  catalog_attribute_values: [
    {
      id: 'av-1',
      account_id: 'acct-a',
      product_id: '11111111-1111-4111-8111-111111111111',
      variant_id: 'var-1',
      attribute_id: 'a-1',
      value: 'Red',
    },
  ],
}

describe('lookupCatalogProduct', () => {
  it('resolves uuid, handle, retailer id, SKU, and Shopify external id', async () => {
    const db = createCatalogMemoryDb(seed)
    const uuid = await lookupCatalogProduct(
      db,
      'acct-a',
      '11111111-1111-4111-8111-111111111111',
    )
    expect(uuid?.title).toBe('Red Bag')
    expect(uuid?.attributes?.[0]?.value).toBe('Red')

    expect((await lookupCatalogProduct(db, 'acct-a', 'red-bag'))?.id).toBe(uuid?.id)
    expect((await lookupCatalogProduct(db, 'acct-a', 'BAG-RED'))?.id).toBe(uuid?.id)
    expect((await lookupCatalogProduct(db, 'acct-a', 'gid://shopify/Product/42'))?.id).toBe(
      uuid?.id,
    )
  })

  it('does not return another account’s product', async () => {
    const db = createCatalogMemoryDb(seed)
    expect(await lookupCatalogProduct(db, 'acct-b', 'red-bag')).toBeNull()
  })
})
