import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/postbus/readiness', () => ({
  accountHasWhatsAppConfig: vi.fn(async () => true),
  accountHasSendApiKey: vi.fn(async () => true),
  listApprovedTemplates: vi.fn(async () => []),
}))

import { GET, PUT } from './route'

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
  mocks.requireRole.mockReset()
})

describe('GET /api/postbus/config', () => {
  it('never returns the encrypted API key', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {
        from: (table: string) => {
          if (table === 'webhook_endpoints') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'row-1',
                    account_id: 'acct-1',
                    postbus_merchant_id: 'm-1',
                    api_base_url: 'https://api.example.com',
                    api_key_encrypted: 'enc_postbus_key_must_not_leak',
                    status: 'connected',
                    notification_settings: { booked: true },
                    connected_at: '2026-01-01T00:00:00.000Z',
                    last_tested_at: null,
                    last_test_result: null,
                  },
                  error: null,
                }),
              }),
            }),
          }
        },
      },
      accountId: 'acct-1',
    })

    const res = await GET()
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(body.connected).toBe(true)
    expect(body.status).toBe('connected')
    expect(body.has_api_key).toBe(true)
    expect(body.api_key_encrypted).toBeUndefined()
    expect(body.api_key).toBeUndefined()
    expect(serialized).not.toContain('enc_postbus_key_must_not_leak')
  })

  it('returns not_connected when no row exists', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      },
      accountId: 'acct-1',
    })

    const res = await GET()
    const body = await res.json()
    expect(body.status).toBe('not_connected')
    expect(body.connected).toBe(false)
    expect(body.account_id).toBe('acct-1')
    expect(body.has_api_key).toBe(false)
  })
})

describe('PUT /api/postbus/config', () => {
  it('ignores routing_mode from the merchant body', async () => {
    let saved: Record<string, unknown> | null = null
    const savedRow = {
      id: 'row-1',
      account_id: 'acct-1',
      postbus_merchant_id: 'org-1',
      routing_mode: 'merchant',
      api_base_url: null,
      api_key_encrypted: null,
      status: 'connected',
      notification_settings: {},
      connected_at: null,
      last_tested_at: null,
      last_test_result: null,
    }
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {
        from: (table: string) => {
          if (table === 'webhook_endpoints') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    maybeSingle: async () => ({ data: null, error: null }),
                  }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: savedRow, error: null }),
              }),
            }),
            update: (payload: Record<string, unknown>) => {
              saved = payload
              return {
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: { ...savedRow, ...payload },
                      error: null,
                    }),
                  }),
                }),
              }
            },
          }
        },
      },
    })

    const res = await PUT(
      new Request('http://localhost/api/postbus/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postbus_merchant_id: 'org-1',
          routing_mode: 'global',
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(saved?.routing_mode).toBe('merchant')
  })

  it('rejects merchant writes when the account is already the global sender', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'row-1',
                  account_id: 'acct-1',
                  routing_mode: 'global',
                  postbus_merchant_id: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      },
    })

    const res = await PUT(
      new Request('http://localhost/api/postbus/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postbus_merchant_id: 'org-1' }),
      }),
    )
    expect(res.status).toBe(403)
  })
})
