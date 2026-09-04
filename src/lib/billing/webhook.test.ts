import { beforeEach, describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import { mapRazorpayStatus, periodStartIso, shouldClearAccountHold } from './fulfillment'
import { __resetPlatformBillingSettingsCache } from './platform-settings'
import { verifyWebhookSignature } from './razorpay'

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}))

describe('period start and hold lift', () => {
  it('reads Razorpay current_start when present', () => {
    expect(periodStartIso({ current_start: 1757030400 })).toBe('2025-09-05T00:00:00.000Z')
    expect(periodStartIso(null)).toBeNull()
    expect(periodStartIso({})).toBeNull()
  })

  it('clears HOLD only after a paid activation', () => {
    expect(shouldClearAccountHold('active')).toBe(true)
    expect(shouldClearAccountHold('past_due')).toBe(false)
    expect(shouldClearAccountHold('cancelled')).toBe(false)
    expect(shouldClearAccountHold('expired')).toBe(false)
  })
})

describe('mapRazorpayStatus', () => {
  it('maps charged/activated to active', () => {
    expect(mapRazorpayStatus('subscription.charged', 'active')).toBe('active')
    expect(mapRazorpayStatus('subscription.activated', 'active')).toBe('active')
  })

  it('maps cancelled after the event', () => {
    expect(mapRazorpayStatus('subscription.cancelled', 'cancelled')).toBe('cancelled')
    expect(mapRazorpayStatus('subscription.halted', 'halted')).toBe('past_due')
  })
})

describe('verifyWebhookSignature', () => {
  beforeEach(() => {
    __resetPlatformBillingSettingsCache()
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
    delete process.env.RAZORPAY_KEY_ID
    delete process.env.RAZORPAY_KEY_SECRET
  })

  it('rejects a bad signature', async () => {
    await expect(verifyWebhookSignature('{"event":"x"}', 'nope')).resolves.toBe(false)
  })

  it('accepts a matching HMAC from env fallback', async () => {
    const raw = '{"event":"subscription.charged"}'
    const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex')
    await expect(verifyWebhookSignature(raw, sig)).resolves.toBe(true)
  })
})

describe('recordWebhookEvent idempotency', () => {
  it('treats unique-violation as a no-op insert', async () => {
    vi.resetModules()
    const insert = vi.fn().mockResolvedValue({
      error: { code: '23505', message: 'duplicate' },
    })
    vi.doMock('@/lib/ai/admin-client', () => ({
      supabaseAdmin: () => ({
        from: () => ({ insert }),
      }),
    }))
    const { recordWebhookEvent } = await import('./fulfillment')
    await expect(recordWebhookEvent('evt_1', 'subscription.charged', {})).resolves.toBe(
      false,
    )
  })
})
