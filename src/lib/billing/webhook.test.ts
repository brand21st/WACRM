import { describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import { mapRazorpayStatus } from './fulfillment'
import { verifyWebhookSignature } from './razorpay'

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
  it('rejects a bad signature', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
    expect(verifyWebhookSignature('{"event":"x"}', 'nope')).toBe(false)
  })

  it('accepts a matching HMAC', () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec'
    const raw = '{"event":"subscription.charged"}'
    const sig = crypto.createHmac('sha256', 'whsec').update(raw).digest('hex')
    expect(verifyWebhookSignature(raw, sig)).toBe(true)
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
