import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  loadShopifyConfig: vi.fn(),
  syncStoreContent: vi.fn(),
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>(
    '@/lib/auth/account',
  )
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { shopifyCatalogSync: { limit: 10, windowMs: 60_000 } },
}))

vi.mock('@/lib/shopify/config', () => ({
  loadShopifyConfig: (...args: unknown[]) => mocks.loadShopifyConfig(...args),
}))

vi.mock('@/lib/shopify/store-content', () => ({
  syncStoreContent: (...args: unknown[]) => mocks.syncStoreContent(...args),
}))

import { GET, POST } from './route'

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
  mocks.requireRole.mockReset()
  mocks.loadShopifyConfig.mockReset()
  mocks.syncStoreContent.mockReset()
})

describe('GET /api/shopify/content/sync', () => {
  it('lists synced policies, pages, and products for the account', async () => {
    const contentChain = {
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    }
    contentChain.eq.mockReturnValue(contentChain)
    contentChain.order.mockReturnValue(contentChain)
    contentChain.limit.mockResolvedValue({
      data: [
        {
          id: 'p1',
          kind: 'policy',
          title: 'Refund',
          handle: 'refund-policy',
          page_url: 'https://shop.example/policies/refund',
          body: 'Returns in 30 days.',
          synced_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    })
    const productChain = {
      eq: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
    }
    productChain.eq.mockReturnValue(productChain)
    productChain.order.mockReturnValue(productChain)
    productChain.limit.mockResolvedValue({
      data: [
        {
          shopify_product_id: 'gid://shopify/Product/1',
          handle: 'teddy',
          title: 'Teddy Bear',
          body: 'Soft plush toy.',
          body_excerpt: 'Soft plush toy.',
          price_min: '490',
          price_max: '490',
          currency: 'INR',
          product_url: 'https://shop.example/products/teddy',
          image_url: 'https://cdn.example/teddy.jpg',
          variant_summary: [
            { title: 'Default', price: '490', available: true, sku: 'TED-1' },
          ],
        },
      ],
      error: null,
    })
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {
        from: (table: string) => ({
          select: () => (table === 'shopify_catalog_products' ? productChain : contentChain),
        }),
      },
    })

    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.count).toBe(1)
    expect(json.items[0].title).toBe('Refund')
    expect(json.items[0].body).toBe('Returns in 30 days.')
    expect(json.product_count).toBe(1)
    expect(json.products[0].title).toBe('Teddy Bear')
    expect(json.products[0].body).toBe('Soft plush toy.')
    expect(json.products[0].variants).toEqual([
      { title: 'Default', price: '490', available: true, sku: 'TED-1' },
    ])
  })
})

describe('POST /api/shopify/content/sync', () => {
  it('syncs when Shopify is connected', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.loadShopifyConfig.mockResolvedValue({ accountId: 'acct-1' })
    mocks.syncStoreContent.mockResolvedValue({ count: 4 })

    const res = await POST()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.count).toBe(4)
    expect(mocks.syncStoreContent).toHaveBeenCalled()
  })
})
