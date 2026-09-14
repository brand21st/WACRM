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
  it('lists synced policies and pages for the account', async () => {
    const order = vi.fn()
    const chain = {
      eq: vi.fn(),
      order,
      limit: vi.fn(),
    }
    chain.eq.mockReturnValue(chain)
    chain.order.mockReturnValue(chain)
    chain.limit.mockResolvedValue({
      data: [
        {
          id: 'p1',
          kind: 'policy',
          title: 'Refund',
          handle: 'refund-policy',
          page_url: 'https://shop.example/policies/refund',
          synced_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      error: null,
    })
    mocks.getCurrentAccount.mockResolvedValue({
      accountId: 'acct-1',
      supabase: { from: () => ({ select: () => chain }) },
    })

    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.count).toBe(1)
    expect(json.items[0].title).toBe('Refund')
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
