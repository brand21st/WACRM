import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const upsert = vi.fn()
  return {
    maybeSingle,
    upsert,
    encrypt: vi.fn((value: string) => `enc:${value}`),
    resolveGoogleOAuthCredentials: vi.fn(),
    resetCache: vi.fn(),
  }
})

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: vi.fn(async () => ({
    userId: 'admin-1',
    user: { id: 'admin-1' },
    admin: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: mocks.maybeSingle,
          }),
        }),
        upsert: (row: unknown) => {
          mocks.upsert(row)
          return Promise.resolve({ error: null })
        },
      }),
    },
  })),
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/google-sheets/platform-settings', () => ({
  __resetPlatformGoogleSettingsCache: mocks.resetCache,
  isGoogleClientId: (value: string) =>
    /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(value.trim()),
  resolveGoogleOAuthCredentials: mocks.resolveGoogleOAuthCredentials,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  encrypt: mocks.encrypt,
}))

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
  checkRateLimit: () => ({ success: true, remaining: 29, reset: Date.now(), limit: 30 }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
}))

import { GET, PUT } from './route'

const VALID_ID = '123456789012-abcdef.apps.googleusercontent.com'

beforeEach(() => {
  mocks.maybeSingle.mockReset()
  mocks.upsert.mockReset()
  mocks.encrypt.mockClear()
  mocks.resetCache.mockClear()
  mocks.resolveGoogleOAuthCredentials.mockResolvedValue({
    clientId: '',
    clientSecret: '',
    source: 'none',
    configured: false,
  })
  mocks.maybeSingle.mockResolvedValue({
    data: { google_client_id: null, google_client_secret: null },
    error: null,
  })
})

describe('GET /api/super-admin/google', () => {
  it('never returns the client secret', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        google_client_id: VALID_ID,
        google_client_secret: 'enc:google-secret-must-not-leak',
      },
      error: null,
    })
    mocks.resolveGoogleOAuthCredentials.mockResolvedValue({
      clientId: VALID_ID,
      clientSecret: 'plain-secret',
      source: 'database',
      configured: true,
    })

    const res = await GET(new Request('http://localhost/api/super-admin/google'))
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(res.status).toBe(200)
    expect(body.google_client_id).toBe(VALID_ID)
    expect(body.has_google_client_secret).toBe(true)
    expect(body.configured).toBe(true)
    expect(body.redirect_uri).toContain('/api/google/sheets/oauth/callback')
    expect(body.google_client_secret).toBeUndefined()
    expect(serialized).not.toContain('enc:google-secret-must-not-leak')
    expect(serialized).not.toContain('plain-secret')
  })
})

describe('PUT /api/super-admin/google', () => {
  it('rejects a client ID that is not a Google web client', async () => {
    const res = await PUT(
      new Request('http://localhost/api/super-admin/google', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ google_client_id: 'not-a-google-id' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('encrypts the client secret and never echoes it back', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        google_client_id: VALID_ID,
        google_client_secret: 'enc:saved',
      },
      error: null,
    })
    mocks.resolveGoogleOAuthCredentials.mockResolvedValue({
      clientId: VALID_ID,
      clientSecret: 'saved',
      source: 'database',
      configured: true,
    })

    const res = await PUT(
      new Request('http://localhost/api/super-admin/google', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          google_client_id: VALID_ID,
          google_client_secret: 'fresh-secret',
        }),
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mocks.encrypt).toHaveBeenCalledWith('fresh-secret')
    expect(mocks.upsert).toHaveBeenCalledWith({
      id: 1,
      google_client_id: VALID_ID,
      google_client_secret: 'enc:fresh-secret',
    })
    expect(mocks.resetCache).toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('fresh-secret')
    expect(body.has_google_client_secret).toBe(true)
  })
})
