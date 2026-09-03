import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_ENTITLEMENTS } from './types'
import { startOfUtcMonth, subscriptionIsLive } from './entitlements'

describe('subscriptionIsLive', () => {
  it('treats active and past_due as live', () => {
    expect(subscriptionIsLive('active', null)).toBe(true)
    expect(subscriptionIsLive('past_due', null)).toBe(true)
    expect(subscriptionIsLive('expired', null)).toBe(false)
  })

  it('keeps cancelled access until current_period_end', () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(subscriptionIsLive('cancelled', future)).toBe(true)
    expect(subscriptionIsLive('cancelled', past)).toBe(false)
  })
})

describe('startOfUtcMonth', () => {
  it('returns the first UTC day of the month', () => {
    const d = startOfUtcMonth(new Date('2026-09-15T12:00:00Z'))
    expect(d.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('FALLBACK_ENTITLEMENTS', () => {
  it('denies paid features', () => {
    expect(FALLBACK_ENTITLEMENTS.aiEnabled).toBe(false)
    expect(FALLBACK_ENTITLEMENTS.callingEnabled).toBe(false)
    expect(FALLBACK_ENTITLEMENTS.callRecordingEnabled).toBe(false)
    expect(FALLBACK_ENTITLEMENTS.callForwardingEnabled).toBe(false)
    expect(FALLBACK_ENTITLEMENTS.whatsappEnabled).toBe(true)
    expect(FALLBACK_ENTITLEMENTS.shopifyEnabled).toBe(false)
    expect(FALLBACK_ENTITLEMENTS.maxSeats).toBe(1)
  })
})

describe('feature asserts', () => {
  it('rejects Shopify and Live calling AI when the package disables them', async () => {
    vi.resetModules()
    vi.doMock('@/lib/ai/admin-client', () => ({
      supabaseAdmin: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  package_id: 'pkg',
                  status: 'active',
                  source: 'comp',
                  current_period_end: null,
                  cancel_at_period_end: false,
                  billing_packages: {
                    id: 'pkg',
                    name: 'Free',
                    slug: 'free',
                    description: null,
                    interval: 'month',
                    amount_paise: 0,
                    currency: 'INR',
                    is_active: true,
                    is_free: true,
                    sort_order: 0,
                    razorpay_plan_id: null,
                    ai_enabled: false,
                    ai_monthly_token_cap: null,
                    max_seats: 2,
                    calling_enabled: false,
                    call_recording_enabled: false,
                    call_forwarding_enabled: false,
                    whatsapp_enabled: false,
                    whatsapp_monthly_message_cap: null,
                    shopify_enabled: false,
                  },
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    }))
    const {
      assertWhatsAppConnect,
      assertShopifyConnect,
      assertCalling,
      assertCallRecording,
      assertCallForwarding,
      EntitlementError,
    } = await import('./entitlements')
    await expect(assertWhatsAppConnect('acc-1')).resolves.toBeUndefined()
    await expect(assertShopifyConnect('acc-1')).rejects.toBeInstanceOf(EntitlementError)
    await expect(assertCalling('acc-1')).rejects.toBeInstanceOf(EntitlementError)
    await expect(assertCallRecording('acc-1')).rejects.toBeInstanceOf(EntitlementError)
    await expect(assertCallForwarding('acc-1')).rejects.toBeInstanceOf(EntitlementError)
  })

  it('rejects invites once max seats are used', async () => {
    vi.resetModules()
    const livePackage = {
      id: 'pkg',
      name: 'Free',
      slug: 'free',
      description: null,
      interval: 'month',
      amount_paise: 0,
      currency: 'INR',
      is_active: true,
      is_free: true,
      sort_order: 0,
      razorpay_plan_id: null,
      ai_enabled: false,
      ai_monthly_token_cap: null,
      max_seats: 1,
      calling_enabled: false,
      call_recording_enabled: false,
      call_forwarding_enabled: false,
      whatsapp_enabled: true,
      whatsapp_monthly_message_cap: null,
      shopify_enabled: false,
    }
    vi.doMock('@/lib/ai/admin-client', () => ({
      supabaseAdmin: () => ({
        from: (table: string) => {
          if (table === 'account_subscriptions') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      package_id: 'pkg',
                      status: 'active',
                      source: 'comp',
                      current_period_end: null,
                      cancel_at_period_end: false,
                      billing_packages: livePackage,
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          const counted = {
            select: () => counted,
            eq: () => counted,
            is: () => counted,
            gt: () => counted,
            then: (resolve: (value: { count: number }) => unknown) =>
              resolve({ count: table === 'profiles' ? 1 : 0 }),
          }
          return counted
        },
      }),
    }))
    const { assertSeatAvailable, EntitlementError } = await import('./entitlements')
    await expect(assertSeatAvailable('acc-1')).rejects.toBeInstanceOf(EntitlementError)
  })
})
