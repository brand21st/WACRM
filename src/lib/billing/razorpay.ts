import crypto from 'crypto'

import type { BillingInterval } from './types'
import { razorpayPlanPeriod } from './interval'
import { resolveBillingCredentials } from './platform-settings'

const API = 'https://api.razorpay.com/v1'

export class RazorpayConfigError extends Error {
  constructor(message = 'Razorpay is not configured') {
    super(message)
    this.name = 'RazorpayConfigError'
  }
}

export function isValidRazorpayKeyId(keyId: string): boolean {
  return keyId.startsWith('rzp_test_') || keyId.startsWith('rzp_live_')
}

export function razorpayKeyMode(keyId: string): 'test' | 'live' | null {
  if (keyId.startsWith('rzp_test_')) return 'test'
  if (keyId.startsWith('rzp_live_')) return 'live'
  return null
}

export async function razorpayKeyId(): Promise<string> {
  const creds = await resolveBillingCredentials()
  return creds.keyId
}

export async function isRazorpayConfigured() {
  const creds = await resolveBillingCredentials()
  return creds.configured
}

export async function assertRazorpayConfigured() {
  if (!(await isRazorpayConfigured())) {
    throw new RazorpayConfigError()
  }
}

export async function validateRazorpayKeys(keyId: string, keySecret: string): Promise<void> {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64')
  const res = await fetch(`${API}/payments?count=1`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { description?: string }
    } | null
    throw new Error(body?.error?.description || 'Razorpay rejected these keys')
  }
}

async function razorpayFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const creds = await resolveBillingCredentials()
  if (!creds.configured) throw new RazorpayConfigError()
  const auth = Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString('base64')
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: { description?: string } })
    | null
  if (!res.ok) {
    const message = body?.error?.description || `Razorpay request failed (${res.status})`
    throw new Error(message)
  }
  return body as T
}

export interface RazorpayPlan {
  id: string
}

export async function syncRazorpayPlan(args: {
  name: string
  description: string | null
  amountPaise: number
  currency: string
  interval: BillingInterval
}): Promise<string> {
  const cadence = razorpayPlanPeriod(args.interval)
  const plan = await razorpayFetch<RazorpayPlan>('/plans', {
    method: 'POST',
    body: JSON.stringify({
      period: cadence.period,
      interval: cadence.interval,
      item: {
        name: args.name,
        amount: args.amountPaise,
        currency: args.currency,
        description: args.description ?? args.name,
      },
    }),
  })
  return plan.id
}

/** Sync a Plan when keys exist. Paid packages can still be saved locally without Razorpay. */
export async function maybeSyncRazorpayPlan(args: {
  name: string
  description: string | null
  amountPaise: number
  currency: string
  interval: BillingInterval
}): Promise<{ planId: string | null; warning?: string }> {
  if (!(await isRazorpayConfigured())) {
    return {
      planId: null,
      warning:
        'Package saved without a Razorpay Plan. Add Razorpay keys in Super Admin → Settings so merchants can subscribe.',
    }
  }
  return { planId: await syncRazorpayPlan(args) }
}

export async function createRazorpayCustomer(args: {
  name: string
  email: string
  notes: Record<string, string>
}): Promise<string> {
  const customer = await razorpayFetch<{ id: string }>('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: args.name,
      email: args.email,
      notes: args.notes,
    }),
  })
  return customer.id
}

export async function createRazorpaySubscription(args: {
  planId: string
  customerId?: string
  notes: Record<string, string>
  totalCount?: number
}): Promise<{ id: string }> {
  return razorpayFetch<{ id: string }>('/subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: args.planId,
      customer_id: args.customerId,
      total_count: args.totalCount ?? 120,
      notes: args.notes,
      customer_notify: 1,
    }),
  })
}

export async function cancelRazorpaySubscription(
  subscriptionId: string,
  cancelAtCycleEnd: boolean,
): Promise<void> {
  await razorpayFetch(`/subscriptions/${subscriptionId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ cancel_at_cycle_end: cancelAtCycleEnd ? 1 : 0 }),
  })
}

export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const { webhookSecret } = await resolveBillingCredentials()
  if (!webhookSecret || !signature) return false
  const expected = crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export async function verifyCheckoutSignature(args: {
  subscriptionId: string
  paymentId: string
  signature: string
}): Promise<boolean> {
  const { keySecret } = await resolveBillingCredentials()
  if (!keySecret) return false
  const payload = `${args.paymentId}|${args.subscriptionId}`
  const expected = crypto.createHmac('sha256', keySecret).update(payload).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(args.signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
