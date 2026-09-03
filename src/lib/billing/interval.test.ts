import { describe, expect, it } from 'vitest'
import {
  addBillingPeriod,
  intervalMonths,
  intervalPriceSuffix,
  monthlyRecurringPaise,
  parseBillingInterval,
  razorpayPlanPeriod,
} from './interval'

describe('parseBillingInterval', () => {
  it('accepts month, quarter, and year', () => {
    expect(parseBillingInterval('month')).toBe('month')
    expect(parseBillingInterval('quarter')).toBe('quarter')
    expect(parseBillingInterval('year')).toBe('year')
    expect(parseBillingInterval('nope')).toBe('month')
  })
})

describe('interval helpers', () => {
  it('maps quarter to 3 months', () => {
    expect(intervalMonths('quarter')).toBe(3)
    expect(intervalPriceSuffix('quarter')).toBe('3 months')
    expect(monthlyRecurringPaise(90000, 'quarter')).toBe(30000)
    expect(razorpayPlanPeriod('quarter')).toEqual({ period: 'monthly', interval: 3 })
  })

  it('rolls a quarter period by 3 UTC months', () => {
    const next = addBillingPeriod(new Date('2026-09-03T00:00:00.000Z'), 'quarter')
    expect(next.toISOString()).toBe('2026-12-03T00:00:00.000Z')
  })
})
