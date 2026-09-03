import type { BillingInterval } from './types'

export function parseBillingInterval(value: unknown): BillingInterval {
  if (value === 'year' || value === 'quarter') return value
  return 'month'
}

export function intervalMonths(interval: BillingInterval): number {
  if (interval === 'year') return 12
  if (interval === 'quarter') return 3
  return 1
}

export function intervalPriceSuffix(interval: BillingInterval): string {
  if (interval === 'year') return 'year'
  if (interval === 'quarter') return '3 months'
  return 'month'
}

export function addBillingPeriod(from: Date, interval: BillingInterval): Date {
  const next = new Date(from.getTime())
  next.setUTCMonth(next.getUTCMonth() + intervalMonths(interval))
  return next
}

export function periodEndFromNow(
  interval: BillingInterval,
  now = new Date(),
): string {
  return addBillingPeriod(now, interval).toISOString()
}

export function monthlyRecurringPaise(amountPaise: number, interval: BillingInterval): number {
  return Math.round(amountPaise / intervalMonths(interval))
}

export function razorpayPlanPeriod(interval: BillingInterval): {
  period: 'monthly' | 'yearly'
  interval: number
} {
  if (interval === 'year') return { period: 'yearly', interval: 1 }
  if (interval === 'quarter') return { period: 'monthly', interval: 3 }
  return { period: 'monthly', interval: 1 }
}
