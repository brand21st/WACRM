import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const upsert = vi.fn()
  return {
    maybeSingle,
    upsert,
    encrypt: vi.fn((value: string) => `enc:${value}`),
    resolveFacebookLoginConfig: vi.fn(),
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

vi.mock('@/lib/meta/platform-settings', () => ({
  __resetPlatformMetaSettingsCache: mocks.resetCache,
  isFacebookAppId: (value: string) => /^\d{5,32}$/.test(value.trim()),
  isFacebookLoginConfigId: (value: string) => /^[\w-]{4,128}$/.test(value.trim()),
  resolveFacebookLoginConfig: mocks.resolveFacebookLoginConfig,
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

beforeEach(() => {
  mocks.maybeSingle.mockReset()
  mocks.upsert.mockReset()
  mocks.encrypt.mockClear()
  mocks.resetCache.mockClear()
  mocks.resolveFacebookLoginConfig.mockResolvedValue({
    appId: '',
    configId: '',
    appSecret: '',
    source: 'none',
    enabled: false,
    configured: false,
  })
  mocks.maybeSingle.mockResolvedValue({
    data: {
      facebook_app_id: null,
      facebook_login_config_id: null,
      facebook_app_secret: null,
    },
    error: null,
  })
})

describe('GET /api/super-admin/meta', () => {
  it('never returns the Facebook app secret', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        facebook_app_id: '2367862230404408',
        facebook_login_config_id: 'cfg-1',
        facebook_app_secret: 'enc:facebook-secret-must-not-leak',
      },
      error: null,
    })
    mocks.resolveFacebookLoginConfig.mockResolvedValue({
      appId: '2367862230404408',
      configId: 'cfg-1',
      appSecret: 'plain-secret',
      source: 'database',
      enabled: true,
      configured: true,
    })

    const res = await GET()
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(res.status).toBe(200)
    expect(body.facebook_app_id).toBe('2367862230404408')
    expect(body.facebook_login_config_id).toBe('cfg-1')
    expect(body.has_facebook_app_secret).toBe(true)
    expect(body.configured).toBe(true)
    expect(body.facebook_app_secret).toBeUndefined()
    expect(serialized).not.toContain('enc:facebook-secret-must-not-leak')
    expect(serialized).not.toContain('plain-secret')
  })
})

describe('PUT /api/super-admin/meta', () => {
  it('rejects a non-digit Facebook App ID', async () => {
    const res = await PUT(
      new Request('http://localhost/api/super-admin/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facebook_app_id: 'not-digits' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('encrypts the app secret and never echoes it back', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        facebook_app_id: '2367862230404408',
        facebook_login_config_id: 'cfg-1',
        facebook_app_secret: 'enc:saved',
      },
      error: null,
    })
    mocks.resolveFacebookLoginConfig.mockResolvedValue({
      appId: '2367862230404408',
      configId: 'cfg-1',
      appSecret: 'saved',
      source: 'database',
      enabled: true,
      configured: true,
    })

    const res = await PUT(
      new Request('http://localhost/api/super-admin/meta', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facebook_app_id: '2367862230404408',
          facebook_login_config_id: 'cfg-1',
          facebook_app_secret: 'fresh-secret',
        }),
      }),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(mocks.encrypt).toHaveBeenCalledWith('fresh-secret')
    expect(mocks.upsert).toHaveBeenCalledWith({
      id: 1,
      facebook_app_id: '2367862230404408',
      facebook_login_config_id: 'cfg-1',
      facebook_app_secret: 'enc:fresh-secret',
    })
    expect(mocks.resetCache).toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('fresh-secret')
    expect(body.has_facebook_app_secret).toBe(true)
  })
})
