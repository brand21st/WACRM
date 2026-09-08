import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductHit } from '@/lib/shopify/types'
import { createCatalogMemoryDb } from '../search/memory-db'
import { retailerIdForVariant } from '@/lib/shopify/retailer-id'

const upsertProduct = vi.fn()
const replaceImportedAccountProducts = vi.fn()
const deleteImportedShopifyProduct = vi.fn()

vi.mock('../core/commands', () => ({
  upsertProduct: (...args: unknown[]) => upsertProduct(...args),
  replaceImportedAccountProducts: (...args: unknown[]) =>
    replaceImportedAccountProducts(...args),
  deleteImportedShopifyProduct: (...args: unknown[]) =>
    deleteImportedShopifyProduct(...args),
}))

import {
  deleteImportedShopifyProductByIds,
  importShopifyProduct,
  replaceImportedShopifyProducts,
  shopifyHitToCatalogDraft,
  snapshotRowToHit,
} from './shopify-import'

const hit: ShopifyProductHit = {
  id: 'gid://shopify/Product/42',
  handle: 'red-bag',
  title: 'Red Bag',
  description: 'Leather tote',
  imageUrl: 'https://cdn.example/bag.jpg',
  productUrl: 'https://shop.example/products/red-bag',
  cartUrl: null,
  checkoutUrl: null,
  priceMin: '49',
  priceMax: '49',
  currency: 'INR',
  variants: [
    {
      id: 'gid://shopify/ProductVariant/9',
      variantId: '99',
      title: 'Default',
      sku: 'BAG-RED',
      price: '49.00',
      compareAtPrice: null,
      available: true,
      options: [{ name: 'Color', value: 'Red' }],
    },
  ],
}

function dbWithSource(source = 'sku'): SupabaseClient {
  return createCatalogMemoryDb({
    shopify_configs: [{ account_id: 'acct-a', retailer_id_source: source }],
  })
}

describe('shopify import adapter', () => {
  beforeEach(() => {
    upsertProduct.mockReset().mockResolvedValue(null)
    replaceImportedAccountProducts.mockReset().mockResolvedValue(undefined)
    deleteImportedShopifyProduct.mockReset().mockResolvedValue(true)
  })

  it('maps a Shopify hit to a catalog draft with stable retailer ids', () => {
    const draft = shopifyHitToCatalogDraft('acct-a', hit, 'sku')
    expect(draft.origin).toBe('shopify_import')
    expect(draft.locked).toBe(false)
    expect(draft.variants?.[0]?.retailerId).toBe(
      retailerIdForVariant(hit.variants[0], 'sku', hit.id),
    )
    expect(draft.externalIds?.map((e) => e.externalId)).toEqual(
      expect.arrayContaining(['gid://shopify/Product/42', '42']),
    )
    expect(draft.variants?.[0]?.externalIds?.map((e) => e.externalId)).toEqual(
      expect.arrayContaining(['99', 'gid://shopify/ProductVariant/9']),
    )
  })

  it('maps facebook_shopify retailer ids the same way as the existing helper', () => {
    const draft = shopifyHitToCatalogDraft('acct-a', hit, 'facebook_shopify')
    expect(draft.variants?.[0]?.retailerId).toBe('shopify_IN_42_99')
  })

  it('maps a snapshot row back to a hit for backfill tests', () => {
    const mapped = snapshotRowToHit({
      shopify_product_id: 'gid://shopify/Product/42',
      handle: 'red-bag',
      title: 'Red Bag',
      body: 'Leather tote',
      price_min: 49,
      currency: 'INR',
      image_url: 'https://cdn.example/bag.jpg',
      variant_summary: [
        {
          id: 'gid://shopify/ProductVariant/9',
          variantId: '99',
          title: 'Default',
          sku: 'BAG-RED',
          price: '49.00',
          available: true,
          options: [{ name: 'Color', value: 'Red' }],
        },
      ],
    })
    expect(mapped.variants[0]?.sku).toBe('BAG-RED')
    expect(
      shopifyHitToCatalogDraft('acct-a', mapped, 'sku').variants?.[0]?.retailerId,
    ).toBe('BAG-RED')
  })

  it('creates Shopify collections and tags the imported product', async () => {
    const db = createCatalogMemoryDb({
      shopify_configs: [{ account_id: 'acct-a', retailer_id_source: 'sku' }],
    })
    await importShopifyProduct(db, 'acct-a', {
      ...hit,
      collections: [
        { handle: 'best-seller', title: 'Best Seller' },
        { handle: 'casual-wear', title: 'Casual Wear' },
      ],
    })
    const { data: sets } = await db.from('catalog_collections').select()
    expect(sets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ handle: 'best-seller', title: 'Best Seller' }),
        expect.objectContaining({ handle: 'casual-wear', title: 'Casual Wear' }),
      ]),
    )
    expect(upsertProduct).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        collectionIds: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
        ]),
      }),
    )
  })

  it('imports one product through the catalog writer', async () => {
    await importShopifyProduct(dbWithSource('sku'), 'acct-a', hit)
    expect(upsertProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-a',
        handle: 'red-bag',
        origin: 'shopify_import',
      }),
    )
  })

  it('replaces imported products for one account only', async () => {
    await replaceImportedShopifyProducts(dbWithSource('sku'), 'acct-a', [hit])
    expect(replaceImportedAccountProducts).toHaveBeenCalledWith(
      expect.anything(),
      'acct-a',
      [
        expect.objectContaining({
          accountId: 'acct-a',
          handle: 'red-bag',
        }),
      ],
    )
  })

  it('deletes imported Shopify products by external id', async () => {
    await deleteImportedShopifyProductByIds(dbWithSource(), 'acct-a', [
      '42',
      'gid://shopify/Product/42',
    ])
    expect(deleteImportedShopifyProduct).toHaveBeenCalledWith(
      expect.anything(),
      'acct-a',
      ['42', 'gid://shopify/Product/42'],
    )
  })
})
