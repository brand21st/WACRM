import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: vi.fn(),
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

import { GET } from './route'

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
})

describe('GET /api/shopify/config', () => {
  it('never returns the Admin API token', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  shop_domain: 'acme.myshopify.com',
                  access_token: 'shpat_secret_must_not_leak',
                  is_active: true,
                  shop_name: 'Acme',
                  primary_domain: 'https://shop.example',
                  currency: 'USD',
                  client_id: 'abcdef0123456789abcdef0123456789',
                  meta_catalog_id: null,
                  last_verified_at: null,
                  last_catalog_sync_at: null,
                  catalog_product_count: 0,
                },
                error: null,
              }),
            }),
          }),
        }),
      },
      accountId: 'acct-1',
    })

    const res = await GET()
    const body = await res.json()
    expect(body.has_token).toBe(true)
    expect(body.access_token).toBeUndefined()
    expect(body.client_id).toBe('abcdef0123456789abcdef0123456789')
    expect(JSON.stringify(body)).not.toContain('shpat_secret_must_not_leak')
  })
})
