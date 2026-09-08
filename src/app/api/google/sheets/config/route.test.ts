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

vi.mock('@/lib/google-sheets/oauth', () => ({
  GoogleOAuthError: class GoogleOAuthError extends Error {
    code = 'oauth_failed'
  },
  refreshGoogleAccessToken: vi.fn(),
  revokeGoogleToken: vi.fn(),
}))

import { GET } from './route'

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
})

describe('GET /api/google/sheets/config', () => {
  it('never returns access or refresh tokens', async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'row-1',
                  google_email: 'owner@example.com',
                  google_account_id: 'gid',
                  access_token: 'enc_access_must_not_leak',
                  refresh_token: 'enc_refresh_must_not_leak',
                  token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
                  scopes: ['email'],
                  spreadsheet_name: null,
                  last_synced_at: null,
                  status: 'connected',
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
    const serialized = JSON.stringify(body)
    expect(body.connected).toBe(true)
    expect(body.status).toBe('connected')
    expect(body.accountLabel).toBe('owner@example.com')
    expect(body.access_token).toBeUndefined()
    expect(body.refresh_token).toBeUndefined()
    expect(serialized).not.toContain('enc_access_must_not_leak')
    expect(serialized).not.toContain('enc_refresh_must_not_leak')
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
    expect(body).toEqual({ connected: false, status: 'not_connected' })
  })
})
