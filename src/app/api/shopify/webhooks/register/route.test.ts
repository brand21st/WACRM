import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadShopifyConfig: vi.fn(),
  registerCatalogWebhooks: vi.fn(),
  webhookCallbackUrl: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { shopifyCatalogSync: { limit: 6, windowMs: 60_000 } },
}))

vi.mock('@/lib/shopify/config', () => ({
  loadShopifyConfig: (...args: unknown[]) => mocks.loadShopifyConfig(...args),
}))

vi.mock('@/lib/shopify/register-webhooks', () => ({
  registerCatalogWebhooks: (...args: unknown[]) =>
    mocks.registerCatalogWebhooks(...args),
  webhookCallbackUrl: (...args: unknown[]) => mocks.webhookCallbackUrl(...args),
}))

import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadShopifyConfig.mockReset()
  mocks.registerCatalogWebhooks.mockReset()
  mocks.webhookCallbackUrl.mockReset()
})

describe('POST /api/shopify/webhooks/register', () => {
  it('registers missing topics on the connected shop', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
    })
    mocks.webhookCallbackUrl.mockReturnValue(
      'https://app.example/api/shopify/webhook',
    )
    mocks.registerCatalogWebhooks.mockResolvedValue({
      registered: ['products/update'],
      skipped: ['products/create'],
    })

    const res = await POST()
    const body = await res.json()
    expect(res.ok).toBe(true)
    expect(mocks.registerCatalogWebhooks).toHaveBeenCalled()
    expect(body.registered).toEqual(['products/update'])
    expect(body.skipped).toEqual(['products/create'])
    expect(body.address).toBe('https://app.example/api/shopify/webhook')
  })

  it('rejects when Shopify is not connected', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.loadShopifyConfig.mockResolvedValue(null)
    const res = await POST()
    expect(res.status).toBe(400)
    expect(mocks.registerCatalogWebhooks).not.toHaveBeenCalled()
  })
})
