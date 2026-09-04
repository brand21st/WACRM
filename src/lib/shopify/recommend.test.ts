import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'

const h = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  searchProductsLive: vi.fn(),
  listBestSelling: vi.fn(),
}))

vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog')>()
  return {
    ...actual,
    searchProducts: h.searchProducts,
    searchProductsLive: h.searchProductsLive,
    listBestSelling: h.listBestSelling,
  }
})

import {
  collectInterestTerms,
  fetchAjaxRecommendations,
  listRecommendedProducts,
} from './recommend'
import { executeShopifyTool } from './tools'

const STORE: ShopifyStoreConfig = {
  accountId: 'a',
  shopDomain: 'acme.myshopify.com',
  accessToken: 't',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'USD',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

function hit(id: string, title: string, handle = id): ShopifyProductHit {
  return {
    id: `gid://shopify/Product/${id}`,
    handle,
    title,
    description: title,
    imageUrl: `https://cdn.example/${handle}.jpg`,
    productUrl: `https://shop.example/products/${handle}`,
    cartUrl: `https://shop.example/cart/${id}:1`,
    checkoutUrl: `https://shop.example/cart/${id}:1?checkout`,
    priceMin: '49.00',
    priceMax: '49.00',
    currency: 'USD',
    variants: [],
  }
}

describe('collectInterestTerms', () => {
  it('keeps remembered products and preferences, drops channel noise', () => {
    expect(
      collectInterestTerms({
        query: 'wedding',
        products: ['Pournami Red', 'Pournami Red'],
        preferences: ['size M', 'WhatsApp'],
        intent: 'buy saree',
      }),
    ).toEqual(['wedding', 'Pournami Red', 'size M', 'buy saree'])
  })
})

describe('fetchAjaxRecommendations', () => {
  it('reads handles from the Shopify storefront recommendations API', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        products: [
          { handle: 'silk-coat', title: 'Silk Coat' },
          { handle: '', title: 'Skip' },
        ],
      }),
    )
    const rows = await fetchAjaxRecommendations({
      primaryDomain: 'https://shop.example',
      productId: '17',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://shop.example/recommendations/products.json?product_id=17&limit=10&intent=related',
      expect.anything(),
    )
    expect(rows).toEqual([{ handle: 'silk-coat', title: 'Silk Coat' }])
  })
})

describe('listRecommendedProducts', () => {
  beforeEach(() => {
    h.searchProducts.mockReset()
    h.searchProductsLive.mockReset()
    h.listBestSelling.mockReset()
  })

  it('seeds from customer interest and hydrates Shopify related products', async () => {
    h.searchProducts.mockResolvedValue([hit('17', 'Pournami Red', 'pournami-red')])
    h.searchProductsLive.mockResolvedValue([
      hit('35', 'Silk Coat', 'silk-coat'),
      hit('13', 'Wooden Computer', 'wooden-computer'),
    ])
    const fetchImpl = vi.fn(async () =>
      Response.json({
        products: [
          { handle: 'silk-coat', title: 'Silk Coat' },
          { handle: 'wooden-computer', title: 'Wooden Computer' },
        ],
      }),
    )

    const hits = await listRecommendedProducts(
      {} as SupabaseClient,
      STORE,
      { products: ['Pournami Red'] },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(h.searchProducts).toHaveBeenCalledWith(
      expect.anything(),
      STORE,
      'Pournami Red',
      1,
    )
    expect(h.searchProductsLive).toHaveBeenCalledWith(
      STORE,
      'handle:silk-coat OR handle:wooden-computer',
      { first: 10 },
    )
    expect(hits.map((p) => p.title)).toEqual(['Silk Coat', 'Wooden Computer'])
  })

  it('falls back to best selling when there is no interest match', async () => {
    h.searchProducts.mockResolvedValue([])
    h.listBestSelling.mockResolvedValue([hit('9', 'Best Bag', 'best-bag')])
    const hits = await listRecommendedProducts({} as SupabaseClient, STORE, {})
    expect(h.listBestSelling).toHaveBeenCalled()
    expect(hits[0].title).toBe('Best Bag')
  })
})

describe('executeShopifyTool recommend_products', () => {
  beforeEach(() => {
    h.searchProducts.mockReset()
    h.searchProductsLive.mockReset()
    h.listBestSelling.mockReset()
  })

  it('returns up to 10 interest-based cards', async () => {
    h.searchProducts.mockResolvedValue([hit('17', 'Pournami Red', 'pournami-red')])
    h.searchProductsLive.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => hit(String(i + 1), `Rec ${i + 1}`, `rec-${i + 1}`)),
    )
    const fetchImpl = vi.fn(async () =>
      Response.json({
        products: Array.from({ length: 10 }, (_, i) => ({
          handle: `rec-${i + 1}`,
          title: `Rec ${i + 1}`,
        })),
      }),
    )
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    try {
      const result = await executeShopifyTool(
        {
          db: {} as SupabaseClient,
          config: STORE,
          contactPhone: null,
          customerInterest: { products: ['Pournami Red'] },
        },
        'recommend_products',
        {},
      )
      expect(result.cards).toHaveLength(10)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
