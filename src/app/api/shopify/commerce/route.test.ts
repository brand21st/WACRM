import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  saveCommerceSettings: vi.fn(),
  loadCommerceSettings: vi.fn(),
  ensureCatalogCommerceRow: vi.fn(),
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
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@/lib/shopify/commerce-config', () => ({
  ensureCatalogCommerceRow: mocks.ensureCatalogCommerceRow,
  saveCommerceSettings: mocks.saveCommerceSettings,
  loadCommerceSettings: mocks.loadCommerceSettings,
  publicCommercePayload: (settings: Record<string, unknown>) => ({
    product_card_button: settings.productCardButton,
  }),
}))

import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.saveCommerceSettings.mockReset()
  mocks.loadCommerceSettings.mockReset()
  mocks.ensureCatalogCommerceRow.mockReset()
})

describe('POST /api/shopify/commerce', () => {
  it('saves product_card_button', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.ensureCatalogCommerceRow.mockResolvedValue(undefined)
    mocks.saveCommerceSettings.mockResolvedValue(undefined)
    mocks.loadCommerceSettings.mockResolvedValue({
      productCardButton: 'product',
    })

    const res = await POST(
      new Request('http://localhost/api/shopify/commerce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_card_button: 'product' }),
      }),
    )
    const body = await res.json()
    expect(res.ok).toBe(true)
    expect(mocks.saveCommerceSettings).toHaveBeenCalledWith(
      {},
      'acct-1',
      expect.objectContaining({ productCardButton: 'product' }),
    )
    expect(body.product_card_button).toBe('product')
  })
})
