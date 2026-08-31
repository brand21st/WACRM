import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  handleShopifyProductWebhook,
  removeCatalogProduct,
  upsertCatalogProduct,
} from './catalog'
import * as client from './client'
import * as configModule from './config'
import type { ShopifyStoreConfig } from './types'

const STORE: ShopifyStoreConfig = {
  accountId: 'account-1',
  shopDomain: 'acme.myshopify.com',
  accessToken: 'shpat_test',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'USD',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

function mockDb() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null, count: 1 }),
    }),
  })
  const selectCount = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
  })
  const updateConfig = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })

  const from = vi.fn((table: string) => {
    if (table === 'shopify_catalog_products') {
      return {
        upsert,
        delete: deleteFn,
        select: selectCount,
      }
    }
    if (table === 'shopify_configs') {
      return { update: updateConfig }
    }
    return {}
  })

  return {
    db: { from } as unknown as SupabaseClient,
    upsert,
    deleteFn,
    updateConfig,
  }
}

describe('catalog product webhooks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('upserts an active product from Admin GraphQL', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      product: {
        id: 'gid://shopify/Product/42',
        handle: 'red-bag',
        title: 'Red Bag',
        status: 'ACTIVE',
        createdAt: '2026-01-01T00:00:00Z',
        publishedAt: '2026-01-02T00:00:00Z',
        description: 'Leather tote',
        featuredImage: { url: 'https://cdn.example/bag.jpg' },
        variants: {
          nodes: [
            {
              id: 'gid://shopify/ProductVariant/9',
              legacyResourceId: '99',
              title: 'Default',
              sku: 'BAG-RED',
              availableForSale: true,
              price: '49.00',
              selectedOptions: [{ name: 'Color', value: 'Red' }],
            },
          ],
        },
      },
    })

    const { db, upsert } = mockDb()
    const ok = await upsertCatalogProduct(db, STORE, '42')
    expect(ok).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        shopify_product_id: 'gid://shopify/Product/42',
        title: 'Red Bag',
        body: 'Leather tote',
      }),
      { onConflict: 'account_id,shopify_product_id' },
    )
  })

  it('removes non-active products on update webhook', async () => {
    vi.spyOn(configModule, 'loadShopifyConfig').mockResolvedValue(STORE)
    const { db, deleteFn } = mockDb()

    await handleShopifyProductWebhook(db, STORE.accountId, 'products/update', {
      id: 42,
      status: 'draft',
    })

    expect(deleteFn).toHaveBeenCalled()
  })

  it('removes catalog rows on delete webhook', async () => {
    vi.spyOn(configModule, 'loadShopifyConfig').mockResolvedValue(STORE)
    const { db, deleteFn } = mockDb()

    await handleShopifyProductWebhook(db, STORE.accountId, 'products/delete', {
      admin_graphql_api_id: 'gid://shopify/Product/42',
    })

    expect(deleteFn).toHaveBeenCalled()
  })

  it('retries catalog upsert without body when the column is missing', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      product: {
        id: 'gid://shopify/Product/42',
        handle: 'red-bag',
        title: 'Red Bag',
        status: 'ACTIVE',
        description: 'Leather tote',
        variants: { nodes: [] },
      },
    })
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: 'PGRST204',
          message:
            "Could not find the 'body' column of 'shopify_catalog_products' in the schema cache",
        },
      })
      .mockResolvedValueOnce({ error: null })
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'shopify_catalog_products') {
          return {
            upsert,
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: 1, error: null }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const ok = await upsertCatalogProduct(db, STORE, '42')
    expect(ok).toBe(true)
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(upsert.mock.calls[1][0]).not.toHaveProperty('body')
  })

  it('delete helper matches numeric and gid ids', async () => {
    const inFn = vi.fn().mockResolvedValue({ error: null, count: 1 })
    const eqFn = vi.fn().mockReturnValue({ in: inFn })
    const deleteFn = vi.fn().mockReturnValue({ eq: eqFn })
    const db = {
      from: vi.fn().mockReturnValue({ delete: deleteFn }),
    } as unknown as SupabaseClient

    await removeCatalogProduct(db, 'account-1', '42')
    expect(inFn).toHaveBeenCalledWith(
      'shopify_product_id',
      expect.arrayContaining(['42', 'gid://shopify/Product/42']),
    )
  })
})
