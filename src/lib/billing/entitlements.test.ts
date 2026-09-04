import { describe, expect, it, vi } from 'vitest'
import { FALLBACK_ENTITLEMENTS, type BillingGateInput } from './types'
import { evaluateBillingGate, startOfUtcMonth, subscriptionIsLive } from './entitlements'

const now = new Date('2026-09-05T00:00:00.000Z')

function paidCheckout(overrides: Partial<BillingGateInput> = {}): BillingGateInput {
  return {
    status: 'active',
    source: 'checkout',
    currentPeriodEnd: '2026-09-10T00:00:00.000Z',
    packageName: 'Pro',
    isFree: false,
    amountPaise: 777700,
    ...overrides,
  }
}

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

describe('evaluateBillingGate', () => {
  it('locks when Super Admin sets HOLD, including Free and complimentary', () => {
    expect(
      evaluateBillingGate(
        paidCheckout({
          source: 'comp',
          isFree: true,
          amountPaise: 0,
          accountStatus: 'hold',
        }),
        now,
      ).mode,
    ).toBe('lock')
    expect(
      evaluateBillingGate(paidCheckout({ accountStatus: 'hold' }), now).mode,
    ).toBe('lock')
  })

  it('stays ok for Active Free and complimentary accounts', () => {
    expect(
      evaluateBillingGate(
        paidCheckout({
          source: 'comp',
          isFree: true,
          amountPaise: 0,
          accountStatus: 'active',
        }),
        now,
      ).mode,
    ).toBe('ok')
  })

  it('is ok with no subscription, free plans, and complimentary assigns', () => {
    expect(evaluateBillingGate(null, now).mode).toBe('ok')
    expect(
      evaluateBillingGate(paidCheckout({ isFree: true, amountPaise: 0, source: 'comp' }), now)
        .mode,
    ).toBe('ok')
    expect(
      evaluateBillingGate(
        paidCheckout({ source: 'comp', currentPeriodEnd: '2026-09-01T00:00:00.000Z' }),
        now,
      ).mode,
    ).toBe('ok')
    expect(evaluateBillingGate(paidCheckout({ amountPaise: 0 }), now).mode).toBe('ok')
  })

  it('is ok more than 3 days before period end', () => {
    expect(
      evaluateBillingGate(paidCheckout({ currentPeriodEnd: '2026-09-10T00:00:00.000Z' }), now)
        .mode,
    ).toBe('ok')
  })

  it('warns inside the last 3 days before period end', () => {
    expect(
      evaluateBillingGate(paidCheckout({ currentPeriodEnd: '2026-09-07T00:00:00.000Z' }), now)
        .mode,
    ).toBe('warn')
    expect(
      evaluateBillingGate(paidCheckout({ currentPeriodEnd: '2026-09-06T12:00:00.000Z' }), now)
        .mode,
    ).toBe('warn')
  })

  it('locks at period end, after period end, and when expired', () => {
    expect(
      evaluateBillingGate(paidCheckout({ currentPeriodEnd: '2026-09-05T00:00:00.000Z' }), now)
        .mode,
    ).toBe('lock')
    expect(
      evaluateBillingGate(paidCheckout({ currentPeriodEnd: '2026-09-04T00:00:00.000Z' }), now)
        .mode,
    ).toBe('lock')
    expect(
      evaluateBillingGate(
        paidCheckout({
          status: 'expired',
          currentPeriodEnd: '2026-10-01T00:00:00.000Z',
        }),
        now,
      ).mode,
    ).toBe('lock')
  })

  it('is ok when a paid checkout row has no period end', () => {
    expect(evaluateBillingGate(paidCheckout({ currentPeriodEnd: null }), now).mode).toBe(
      'ok',
    )
  })

  it('keeps past_due before period end out of lock', () => {
    expect(
      evaluateBillingGate(
        paidCheckout({ status: 'past_due', currentPeriodEnd: '2026-09-10T00:00:00.000Z' }),
        now,
      ).mode,
    ).toBe('ok')
    expect(
      evaluateBillingGate(
        paidCheckout({ status: 'past_due', currentPeriodEnd: '2026-09-06T00:00:00.000Z' }),
        now,
      ).mode,
    ).toBe('warn')
  })
})

describe('startOfUtcMonth', () => {
  it('returns the first UTC day of the month', () => {
    const d = startOfUtcMonth(new Date('2026-09-15T12:00:00Z'))
    expect(d.toISOString()).toBe('2026-09-01T00:00:00.000Z')
  })
})

describe('loadAccountBillingGate', () => {
  it('locks a complimentary Free account when accounts.status is hold', async () => {
    vi.resetModules()
    vi.doMock('@/lib/ai/admin-client', () => ({
      supabaseAdmin: () => ({
        from: (table: string) => {
          if (table === 'accounts') {
            return {
              select: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: { status: 'hold' }, error: null }),
                }),
              }),
            }
          }
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    status: 'active',
                    source: 'comp',
                    current_period_end: null,
                    billing_packages: { name: 'Free', is_free: true, amount_paise: 0 },
                  },
                  error: null,
                }),
              }),
            }),
          }
        },
      }),
    }))
    const { loadAccountBillingGate } = await import('./entitlements')
    await expect(loadAccountBillingGate('acc-1')).resolves.toMatchObject({
      mode: 'lock',
      packageName: 'Free',
    })
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
