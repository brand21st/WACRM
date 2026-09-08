import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import { mapCartLinesToShopify } from './map-lines'

describe('mapCartLinesToShopify', () => {
  it('resolves WACRM catalog variants before the Shopify snapshot', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'p1', account_id: 'acct-a', title: 'Kurti' },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Red / S',
          sku: 'K-RED-S',
          price: 499,
          retailer_id: 'K-RED-S',
        },
      ],
      catalog_external_ids: [],
    })
    const result = await mapCartLinesToShopify(
      db,
      'acct-a',
      [{ product_retailer_id: 'K-RED-S', quantity: 2, item_price: 499 }],
      'sku',
    )
    expect(result.missing).toEqual([])
    expect(result.lines).toEqual([
      expect.objectContaining({
        retailer_id: 'K-RED-S',
        quantity: 2,
        sku: 'K-RED-S',
        productId: 'p1',
      }),
    ])
  })

  it('leaves unknown retailer ids missing', async () => {
    const db = createCatalogMemoryDb()
    const result = await mapCartLinesToShopify(
      db,
      'acct-a',
      [{ product_retailer_id: 'NOPE', quantity: 1 }],
      'sku',
    )
    expect(result.lines).toEqual([])
    expect(result.missing).toEqual(['NOPE'])
  })
})
