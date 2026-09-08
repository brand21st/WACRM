import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'

const h = vi.hoisted(() => ({
  searchProducts: vi.fn(),
  listBestSelling: vi.fn(),
  listNewArrivals: vi.fn(),
  getCatalogProductsByHandles: vi.fn(),
}))

vi.mock('./catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./catalog')>()
  return {
    ...actual,
    searchProducts: h.searchProducts,
    listBestSelling: h.listBestSelling,
    listNewArrivals: h.listNewArrivals,
  }
})

vi.mock('@/lib/catalog/intelligence/facts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog/intelligence/facts')>()
  return {
    ...actual,
    getCatalogProductsByHandles: (...args: unknown[]) =>
      h.getCatalogProductsByHandles(...args),
  }
})

vi.mock('@/lib/catalog/search/map-hit', () => ({
  catalogProductToHit: (product: { handle: string; title: string; priceMin?: number }) => ({
    id: `gid://shopify/Product/${product.handle}`,
    handle: product.handle,
    title: product.title,
    description: product.title,
    imageUrl: `https://cdn.example/${product.handle}.jpg`,
    productUrl: `https://shop.example/products/${product.handle}`,
    cartUrl: `https://shop.example/cart/${product.handle}:1`,
    checkoutUrl: `https://shop.example/cart/${product.handle}:1?checkout`,
    priceMin:
      product.priceMin != null
        ? String(product.priceMin)
        : product.handle.includes('premium')
          ? '69.00'
          : '49.00',
    priceMax:
      product.priceMin != null
        ? String(product.priceMin)
        : product.handle.includes('premium')
          ? '69.00'
          : '49.00',
    currency: 'USD',
    variants: [],
  }),
}))

import { intelSeed } from '@/lib/catalog/intelligence/facts.test'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import {
  collectInterestTerms,
  fetchAjaxRecommendations,
  listRecommendedProducts,
} from './recommend'
import { executeShopifyTool, shopifyLlmTools } from './tools'

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
    h.listBestSelling.mockReset()
    h.listNewArrivals.mockReset()
    h.getCatalogProductsByHandles.mockReset()
  })

  it('seeds from customer interest and hydrates Shopify related products', async () => {
    h.searchProducts.mockResolvedValue([hit('17', 'Pournami Red', 'pournami-red')])
    h.getCatalogProductsByHandles.mockImplementation(
      async (_db: unknown, _accountId: unknown, handles: string[]) =>
        handles
          .filter((handle) => handle === 'silk-coat' || handle === 'wooden-computer')
          .map((handle) => ({
            handle,
            title: handle === 'silk-coat' ? 'Silk Coat' : 'Wooden Computer',
            status: 'active',
          })),
    )
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
    expect(h.getCatalogProductsByHandles).toHaveBeenCalledWith(
      expect.anything(),
      STORE.accountId,
      ['silk-coat', 'wooden-computer'],
    )
    expect(hits.map((p) => p.title)).toEqual(['Silk Coat', 'Wooden Computer'])
  })

  it('falls back to new arrivals when there is no interest match', async () => {
    h.searchProducts.mockResolvedValue([])
    h.listNewArrivals.mockResolvedValue([hit('9', 'New Bag', 'new-bag')])
    const hits = await listRecommendedProducts({} as SupabaseClient, STORE, {})
    expect(h.listBestSelling).not.toHaveBeenCalled()
    expect(h.listNewArrivals).toHaveBeenCalled()
    expect(hits[0].title).toBe('New Bag')
  })

  it('searches this turn query before remembered products', async () => {
    h.searchProducts.mockImplementation(
      async (_db: unknown, _config: unknown, term: string) => {
        if (term === 'red saree') return [hit('3', 'Red Saree', 'red-saree')]
        if (term === 'Pournami Red') return [hit('17', 'Pournami Red', 'pournami-red')]
        return []
      },
    )
    h.getCatalogProductsByHandles.mockResolvedValue([])
    const fetchImpl = vi.fn(async () => Response.json({ products: [] }))
    await listRecommendedProducts(
      {} as SupabaseClient,
      STORE,
      { query: 'red saree', products: ['Pournami Red'] },
      { limit: 3, fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    const terms = h.searchProducts.mock.calls.map((call) => call[2])
    expect(terms[0]).toBe('red saree')
    expect(terms.indexOf('Pournami Red')).toBeGreaterThan(0)
  })
})

describe('executeShopifyTool recommend_products', () => {
  beforeEach(() => {
    h.searchProducts.mockReset()
    h.listBestSelling.mockReset()
    h.getCatalogProductsByHandles.mockReset()
  })

  it('searches query red saree first', async () => {
    h.searchProducts.mockImplementation(
      async (_db: unknown, _config: unknown, term: string) => {
        if (term === 'red saree') return [hit('3', 'Red Saree', 'red-saree')]
        return []
      },
    )
    h.getCatalogProductsByHandles.mockResolvedValue([])
    const fetchImpl = vi.fn(async () => Response.json({ products: [] }))
    const originalFetch = globalThis.fetch
    globalThis.fetch = fetchImpl as unknown as typeof fetch
    try {
      await executeShopifyTool(
        {
          db: {} as SupabaseClient,
          config: STORE,
          contactPhone: null,
          customerInterest: { products: ['Pournami Red'] },
          customerText: 'red saree',
        },
        'recommend_products',
        { query: 'red saree' },
      )
      expect(h.searchProducts.mock.calls[0][2]).toBe('red saree')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns up to 10 interest-based cards', async () => {
    h.searchProducts.mockResolvedValue([hit('17', 'Pournami Red', 'pournami-red')])
    h.getCatalogProductsByHandles.mockImplementation(
      async (_db: unknown, _accountId: unknown, handles: string[]) =>
        handles.map((handle) => ({
          handle,
          title: handle.startsWith('rec-')
            ? `Rec ${handle.replace('rec-', '')}`
            : handle,
          status: 'active',
        })),
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
          customerText: 'recommend something for me',
        },
        'recommend_products',
        { limit: 10 },
      )
      expect(result.cards).toHaveLength(10)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('upsells a modestly higher related product from the shown card', async () => {
    const seed = hit('17', 'Red Bag', 'red-bag')
    const premium = {
      ...hit('18', 'Premium Red Bag', 'premium-red-bag'),
      priceMin: '69.00',
      priceMax: '69.00',
    }
    h.searchProducts.mockResolvedValue([seed])
    h.getCatalogProductsByHandles.mockImplementation(
      async (_db: unknown, _accountId: unknown, handles: string[]) =>
        handles.includes('premium-red-bag')
          ? [{ handle: 'premium-red-bag', title: 'Premium Red Bag', status: 'active', priceMin: 69 }]
          : [],
    )
    const fetchImpl = vi.fn(async () =>
      Response.json({
        products: [{ handle: 'premium-red-bag', title: 'Premium Red Bag' }],
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
          productCards: [
            {
              title: 'Red Bag',
              imageUrl: null,
              productUrl: 'https://shop.example/products/red-bag',
              cartUrl: null,
              checkoutUrl: 'https://shop.example/cart/17:1?checkout',
              inStock: true,
              caption: 'Red Bag',
            },
          ],
        },
        'recommend_products',
        { role: 'upsell' },
      )
      expect(h.searchProducts.mock.calls[0][2]).toBe('Red Bag')
      expect(result.cards).toHaveLength(1)
      expect(result.cards[0].title).toBe('Premium Red Bag')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('cross-sells related products without requiring the same name', async () => {
    h.searchProducts.mockResolvedValue([hit('17', 'Red Dress', 'red-dress')])
    h.getCatalogProductsByHandles.mockImplementation(
      async (_db: unknown, _accountId: unknown, handles: string[]) =>
        handles.includes('gold-earrings')
          ? [{ handle: 'gold-earrings', title: 'Gold Earrings', status: 'active' }]
          : [],
    )
    const fetchImpl = vi.fn(async () =>
      Response.json({
        products: [{ handle: 'gold-earrings', title: 'Gold Earrings' }],
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
          customerText: 'I want this dress',
          productCards: [
            {
              title: 'Red Dress',
              imageUrl: null,
              productUrl: 'https://shop.example/products/red-dress',
              cartUrl: null,
              checkoutUrl: 'https://shop.example/cart/17:1?checkout',
              inStock: true,
              caption: 'Red Dress',
            },
          ],
        },
        'recommend_products',
        { role: 'cross_sell' },
      )
      expect(result.cards.map((c) => c.title)).toEqual(['Gold Earrings'])
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('recommends from WACRM catalog when Shopify is disconnected', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const disconnected = {
      ...STORE,
      accountId: 'acct-a',
      primaryDomain: null,
      shopName: 'Acme',
    }
    h.searchProducts.mockResolvedValue([])
    const result = await executeShopifyTool(
      {
        db,
        config: disconnected,
        contactPhone: null,
        customerText: 'similar bags',
      },
      'recommend_products',
      { role: 'similar', seed_id: 'p-red', limit: 5 },
    )
    expect(result.cards.length).toBeGreaterThan(0)
    expect(result.cards.map((card) => card.title)).toContain('Navy Bag')
    expect(result.cards.map((card) => card.title)).not.toContain('Other Shop Red Bag')
  })

  it('returns a structured miss when no product meets the budget', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, accountId: 'acct-a', primaryDomain: null },
        contactPhone: null,
        customerText: 'too expensive under 10',
      },
      'recommend_products',
      { role: 'alternative', seed_id: 'p-red', max_price: 10 },
    )
    expect(result.cards).toEqual([])
    expect(JSON.parse(result.json).note).toMatch(/budget/)
  })
})

describe('executeShopifyTool compare_products', () => {
  it('returns comparison rows for two catalog products', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, accountId: 'acct-a', primaryDomain: null },
        contactPhone: null,
      },
      'compare_products',
      { product_ids: ['p-red', 'p-navy'] },
    )
    const body = JSON.parse(result.json)
    expect(result.cards.map((card) => card.title)).toEqual(['Red Bag', 'Navy Bag'])
    expect(body.comparison.productIds).toEqual(['p-red', 'p-navy'])
    expect(body.comparison.rows.some((row: { field: string }) => row.field === 'price')).toBe(
      true,
    )
  })

  it('does not invent a pair for another account', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, accountId: 'acct-b', primaryDomain: null },
        contactPhone: null,
      },
      'compare_products',
      { product_ids: ['p-red', 'p-navy'] },
    )
    const body = JSON.parse(result.json)
    expect(result.cards).toEqual([])
    expect(body.comparison.notes[0]).toMatch(/Need two catalog products/)
  })
})

describe('shopifyLlmTools catalog intelligence', () => {
  it('exposes compare_products and recommend filters when Shopify is off', () => {
    const tools = shopifyLlmTools({ shopifyConnected: false })
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('compare_products')
    expect(names).toContain('recommend_products')
    const recommend = tools.find((tool) => tool.name === 'recommend_products')
    const params = recommend?.parameters as {
      properties?: { role?: { enum?: string[] }; seed_id?: unknown; max_price?: unknown }
    }
    expect(params.properties).toMatchObject({
      seed_id: expect.anything(),
      max_price: expect.anything(),
    })
    expect(params.properties?.role?.enum).toEqual(
      expect.arrayContaining(['similar', 'alternative']),
    )
  })
})
