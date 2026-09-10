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

  it('resolves a numeric WhatsApp variant id to the catalog retailer id', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'p1', account_id: 'acct-a', title: 'Rayon Aline kurti' },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Reddish maroon / 2XL / Rayon',
          sku: null,
          price: 1,
          compare_at_price: 508,
          retailer_id: 'shopify_IN_8752741646494_47869262004382',
        },
      ],
      catalog_external_ids: [
        {
          account_id: 'acct-a',
          product_id: 'p1',
          variant_id: 'v1',
          source: 'shopify',
          entity: 'variant',
          external_id: '47869262004382',
        },
      ],
    })
    const result = await mapCartLinesToShopify(
      db,
      'acct-a',
      [{ product_retailer_id: '47869262004382', quantity: 1, item_price: 1 }],
      'facebook_shopify',
    )
    expect(result.missing).toEqual([])
    expect(result.lines[0]).toEqual(
      expect.objectContaining({
        retailer_id: 'shopify_IN_8752741646494_47869262004382',
        quantity: 1,
        amountPaise: 50800,
        variantId: '47869262004382',
      }),
    )
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
