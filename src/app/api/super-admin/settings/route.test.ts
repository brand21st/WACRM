import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn()
  const upsert = vi.fn()
  const selectAfterUpsert = vi.fn()
  return {
    maybeSingle,
    upsert,
    selectAfterUpsert,
    validateRazorpayKeys: vi.fn(),
    loadPlatformBillingSettings: vi.fn(),
    resolveBillingCredentials: vi.fn(),
    encrypt: vi.fn((value: string) => `enc:${value}`),
  }
})

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: vi.fn(async () => ({
    userId: 'admin-1',
    user: { id: 'admin-1' },
    admin: {
      from: (table: string) => {
        if (table === 'billing_packages') {
          return {
            select: () => Promise.resolve({ data: [], error: null }),
          }
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: mocks.maybeSingle,
            }),
          }),
          upsert: (row: unknown) => {
            mocks.upsert(row)
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  })),
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/billing/platform-settings', () => ({
  __resetPlatformBillingSettingsCache: vi.fn(),
  loadPlatformBillingSettings: mocks.loadPlatformBillingSettings,
  resolveBillingCredentials: mocks.resolveBillingCredentials,
}))

vi.mock('@/lib/billing/razorpay', () => ({
  isValidRazorpayKeyId: (keyId: string) =>
    keyId.startsWith('rzp_test_') || keyId.startsWith('rzp_live_'),
  razorpayKeyMode: (keyId: string) =>
    keyId.startsWith('rzp_test_') ? 'test' : keyId.startsWith('rzp_live_') ? 'live' : null,
  validateRazorpayKeys: mocks.validateRazorpayKeys,
  maybeSyncRazorpayPlan: vi.fn(),
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
  mocks.validateRazorpayKeys.mockReset()
  mocks.encrypt.mockClear()
  mocks.loadPlatformBillingSettings.mockResolvedValue({
    razorpayKeyId: null,
    razorpayKeySecret: null,
    razorpayWebhookSecret: null,
  })
  mocks.resolveBillingCredentials.mockResolvedValue({
    keyId: '',
    keySecret: '',
    webhookSecret: '',
    source: 'none',
    configured: false,
  })
  mocks.maybeSingle.mockResolvedValue({
    data: {
      razorpay_key_id: null,
      razorpay_key_secret: null,
      razorpay_webhook_secret: null,
    },
    error: null,
  })
})

describe('GET /api/super-admin/settings', () => {
  it('never returns stored secrets', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: {
        razorpay_key_id: 'rzp_test_public',
        razorpay_key_secret: 'enc:secret',
        razorpay_webhook_secret: 'enc:whsec',
      },
      error: null,
    })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.razorpay_key_id).toBe('rzp_test_public')
    expect(body.has_razorpay_secret).toBe(true)
    expect(body.has_razorpay_webhook_secret).toBe(true)
    expect(JSON.stringify(body)).not.toContain('enc:secret')
    expect(JSON.stringify(body)).not.toContain('enc:whsec')
  })
})

describe('PUT /api/super-admin/settings', () => {
  it('rejects a Key ID that is not rzp_test_ or rzp_live_', async () => {
    const res = await PUT(
      new Request('http://localhost/api/super-admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ razorpay_key_id: 'not-a-key' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })

  it('encrypts and upserts a webhook secret without calling Razorpay', async () => {
    const res = await PUT(
      new Request('http://localhost/api/super-admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_key_id: '',
          razorpay_webhook_secret: 'whsec-from-test',
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(mocks.validateRazorpayKeys).not.toHaveBeenCalled()
    expect(mocks.encrypt).toHaveBeenCalledWith('whsec-from-test')
    expect(mocks.upsert).toHaveBeenCalledWith({
      id: 1,
      razorpay_key_id: null,
      razorpay_webhook_secret: 'enc:whsec-from-test',
    })
  })

  it('validates a new Key ID + secret pair before the database write', async () => {
    mocks.validateRazorpayKeys.mockRejectedValue(new Error('Razorpay rejected these keys'))
    const res = await PUT(
      new Request('http://localhost/api/super-admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          razorpay_key_id: 'rzp_test_abc',
          razorpay_key_secret: 'secret',
        }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.validateRazorpayKeys).toHaveBeenCalledWith('rzp_test_abc', 'secret')
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
})
