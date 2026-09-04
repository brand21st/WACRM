import { describe, expect, it } from 'vitest'
import { planSweepAction, type SweepSubscriptionRow } from './sweep'

const now = new Date('2026-09-03T00:00:00.000Z')

function row(partial: Partial<SweepSubscriptionRow>): SweepSubscriptionRow {
  return {
    id: 'sub-1',
    status: 'active',
    source: 'comp',
    current_period_end: '2026-09-01T00:00:00.000Z',
    cancel_at_period_end: false,
    billing_packages: { interval: 'quarter', is_free: false },
    ...partial,
  }
}

describe('planSweepAction', () => {
  it('renews a complimentary 3-month plan when the period ended', () => {
    expect(planSweepAction(row({}), now)).toEqual({
      id: 'sub-1',
      kind: 'renew',
      current_period_start: '2026-09-01T00:00:00.000Z',
      current_period_end: '2026-12-01T00:00:00.000Z',
    })
  })

  it('expires cancelled or past-due packages after the period', () => {
    expect(planSweepAction(row({ status: 'past_due' }), now)?.kind).toBe('expire')
    expect(
      planSweepAction(row({ cancel_at_period_end: true }), now)?.kind,
    ).toBe('expire')
  })

  it('expires checkout subscriptions that missed a webhook renewal', () => {
    expect(planSweepAction(row({ source: 'checkout' }), now)?.kind).toBe('expire')
  })

  it('leaves live periods and free packages with no end date alone', () => {
    expect(
      planSweepAction(row({ current_period_end: '2026-12-01T00:00:00.000Z' }), now),
    ).toBeNull()
    expect(planSweepAction(row({ current_period_end: null }), now)).toBeNull()
  })
})
