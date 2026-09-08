import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadCatalogAnalyticsMode: vi.fn(),
  loadCatalogAnalyticsDashboard: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>()
  return {
    ...actual,
    loadCatalogAnalyticsMode: mocks.loadCatalogAnalyticsMode,
    loadCatalogAnalyticsDashboard: mocks.loadCatalogAnalyticsDashboard,
  }
})

import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadCatalogAnalyticsMode.mockReset()
  mocks.loadCatalogAnalyticsDashboard.mockReset()
})

describe('GET /api/catalog/analytics', () => {
  it('hides dashboard data when the flag is off', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', supabase: {} })
    mocks.loadCatalogAnalyticsMode.mockResolvedValue('off')
    const res = await GET(new Request('http://localhost/api/catalog/analytics'))
    const body = await res.json()
    expect(body).toEqual({ enabled: false })
    expect(mocks.loadCatalogAnalyticsDashboard).not.toHaveBeenCalled()
  })

  it('returns account-scoped aggregates when enabled', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', supabase: {} })
    mocks.loadCatalogAnalyticsMode.mockResolvedValue('on')
    mocks.loadCatalogAnalyticsDashboard.mockResolvedValue({
      range: '7d',
      since: '2026-09-01T00:00:00.000Z',
      overview: {
        totalProducts: 1,
        activeProducts: 1,
        outOfStockProducts: 0,
        productsAsked: 1,
        productsAddedToCart: 0,
        productsPurchased: 0,
      },
      topAsked: [],
      topAddedToCart: [],
      topPurchased: [],
      products: [],
    })
    const res = await GET(new Request('http://localhost/api/catalog/analytics?range=7d'))
    expect(res.status).toBe(200)
    expect(mocks.loadCatalogAnalyticsDashboard).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      '7d',
    )
  })
})
