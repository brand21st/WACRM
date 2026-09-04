import { parseBillingInterval, addBillingPeriod } from './interval'
import type { BillingInterval, SubscriptionSource, SubscriptionStatus } from './types'

export interface SweepSubscriptionRow {
  id: string
  status: SubscriptionStatus
  source: SubscriptionSource
  current_period_end: string | null
  cancel_at_period_end: boolean
  billing_packages: {
    interval: BillingInterval | string
    is_free: boolean
  } | {
    interval: BillingInterval | string
    is_free: boolean
  }[] | null
}

export type SweepAction =
  | { id: string; kind: 'expire' }
  | { id: string; kind: 'renew'; current_period_start: string; current_period_end: string }

function packageOf(row: SweepSubscriptionRow) {
  const pkg = row.billing_packages
  if (Array.isArray(pkg)) return pkg[0] ?? null
  return pkg
}

export function planSweepAction(
  row: SweepSubscriptionRow,
  now = new Date(),
): SweepAction | null {
  const end = row.current_period_end ? new Date(row.current_period_end) : null
  if (!end || Number.isNaN(end.getTime()) || end.getTime() > now.getTime()) {
    return null
  }

  if (row.cancel_at_period_end || row.status === 'cancelled' || row.status === 'past_due') {
    return { id: row.id, kind: 'expire' }
  }

  if (row.status !== 'active') return null

  const pkg = packageOf(row)
  if (row.source === 'comp' && pkg && !pkg.is_free) {
    return {
      id: row.id,
      kind: 'renew',
      current_period_start: end.toISOString(),
      current_period_end: addBillingPeriod(end, parseBillingInterval(pkg.interval)).toISOString(),
    }
  }

  if (row.source === 'checkout') {
    return { id: row.id, kind: 'expire' }
  }

  return null
}

export async function runBillingSweep(
  admin: { from: (table: string) => any },
  now = new Date(),
) {
  const { data, error } = await admin
    .from('account_subscriptions')
    .select(
      'id, status, source, current_period_end, cancel_at_period_end, billing_packages (interval, is_free)',
    )
    .in('status', ['active', 'past_due', 'cancelled'])
  if (error) throw new Error(error.message)

  let renewed = 0
  let expired = 0
  for (const row of data ?? []) {
    const action = planSweepAction(row, now)
    if (!action) continue
    if (action.kind === 'expire') {
      const { error: updateErr } = await admin
        .from('account_subscriptions')
        .update({ status: 'expired' })
        .eq('id', action.id)
      if (updateErr) throw new Error(updateErr.message)
      expired += 1
      continue
    }
    const { error: updateErr } = await admin
      .from('account_subscriptions')
      .update({
        current_period_start: action.current_period_start,
        current_period_end: action.current_period_end,
      })
      .eq('id', action.id)
    if (updateErr) throw new Error(updateErr.message)
    renewed += 1
  }

  return { scanned: data?.length ?? 0, renewed, expired }
}
