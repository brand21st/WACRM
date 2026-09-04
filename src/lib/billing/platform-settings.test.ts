import { beforeEach, describe, expect, it, vi } from 'vitest'
import { encrypt } from '@/lib/whatsapp/encryption'

const maybeSingle = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle,
        }),
      }),
    }),
  }),
}))

import {
  __resetPlatformBillingSettingsCache,
  resolveBillingCredentials,
} from './platform-settings'
import { isValidRazorpayKeyId, razorpayKeyMode } from './razorpay'

function clearEnv() {
  delete process.env.RAZORPAY_KEY_ID
  delete process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
  delete process.env.RAZORPAY_KEY_SECRET
  delete process.env.RAZORPAY_WEBHOOK_SECRET
}

describe('resolveBillingCredentials', () => {
  beforeEach(() => {
    __resetPlatformBillingSettingsCache()
    maybeSingle.mockReset()
    clearEnv()
  })

  it('prefers the database when both Key ID and secret are stored', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        razorpay_key_id: 'rzp_test_db',
        razorpay_key_secret: encrypt('db-secret'),
        razorpay_webhook_secret: encrypt('db-wh'),
      },
      error: null,
    })
    process.env.RAZORPAY_KEY_ID = 'rzp_test_env'
    process.env.RAZORPAY_KEY_SECRET = 'env-secret'
    process.env.RAZORPAY_WEBHOOK_SECRET = 'env-wh'

    const creds = await resolveBillingCredentials()
    expect(creds.source).toBe('database')
    expect(creds.configured).toBe(true)
    expect(creds.keyId).toBe('rzp_test_db')
    expect(creds.keySecret).toBe('db-secret')
    expect(creds.webhookSecret).toBe('db-wh')
  })

  it('falls back to env when the database pair is incomplete', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        razorpay_key_id: 'rzp_test_db',
        razorpay_key_secret: null,
        razorpay_webhook_secret: null,
      },
      error: null,
    })
    process.env.RAZORPAY_KEY_ID = 'rzp_test_env'
    process.env.RAZORPAY_KEY_SECRET = 'env-secret'
    process.env.RAZORPAY_WEBHOOK_SECRET = 'env-wh'

    const creds = await resolveBillingCredentials()
    expect(creds.source).toBe('env')
    expect(creds.keyId).toBe('rzp_test_env')
    expect(creds.keySecret).toBe('env-secret')
    expect(creds.webhookSecret).toBe('env-wh')
  })

  it('uses a stored webhook secret even when checkout keys come from env', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        razorpay_key_id: null,
        razorpay_key_secret: null,
        razorpay_webhook_secret: encrypt('db-wh'),
      },
      error: null,
    })
    process.env.RAZORPAY_KEY_ID = 'rzp_test_env'
    process.env.RAZORPAY_KEY_SECRET = 'env-secret'
    process.env.RAZORPAY_WEBHOOK_SECRET = 'env-wh'

    const creds = await resolveBillingCredentials()
    expect(creds.source).toBe('env')
    expect(creds.webhookSecret).toBe('db-wh')
  })

  it('returns none when neither source is complete', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null })
    const creds = await resolveBillingCredentials()
    expect(creds.source).toBe('none')
    expect(creds.configured).toBe(false)
  })

  it('serves a cached row until the cache is reset', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        razorpay_key_id: 'rzp_test_db',
        razorpay_key_secret: encrypt('db-secret'),
        razorpay_webhook_secret: null,
      },
      error: null,
    })
    await resolveBillingCredentials()
    await resolveBillingCredentials()
    expect(maybeSingle).toHaveBeenCalledTimes(1)
    __resetPlatformBillingSettingsCache()
    await resolveBillingCredentials()
    expect(maybeSingle).toHaveBeenCalledTimes(2)
  })
})

describe('razorpay key helpers', () => {
  it('accepts test and live Key IDs', () => {
    expect(isValidRazorpayKeyId('rzp_test_abc')).toBe(true)
    expect(isValidRazorpayKeyId('rzp_live_abc')).toBe(true)
    expect(isValidRazorpayKeyId('rzp_prod_abc')).toBe(false)
    expect(razorpayKeyMode('rzp_test_abc')).toBe('test')
    expect(razorpayKeyMode('rzp_live_abc')).toBe('live')
    expect(razorpayKeyMode('nope')).toBeNull()
  })
})
