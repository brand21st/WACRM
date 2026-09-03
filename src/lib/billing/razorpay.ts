import crypto from 'crypto'

import type { BillingInterval } from './types'
import { razorpayPlanPeriod } from './interval'

const API = 'https://api.razorpay.com/v1'

export class RazorpayConfigError extends Error {
  constructor(message = 'Razorpay is not configured') {
    super(message)
    this.name = 'RazorpayConfigError'
  }
}

export function razorpayKeyId(): string {
  return (process.env.RAZORPAY_KEY_ID ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '').trim()
}

export function razorpayKeySecret(): string {
  return (process.env.RAZORPAY_KEY_SECRET ?? '').trim()
}

export function razorpayWebhookSecret(): string {
  return (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').trim()
}

export function isRazorpayConfigured() {
  return Boolean(razorpayKeyId() && razorpayKeySecret())
}

export function assertRazorpayConfigured() {
  if (!isRazorpayConfigured()) {
    throw new RazorpayConfigError()
  }
}

async function razorpayFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  assertRazorpayConfigured()
  const auth = Buffer.from(`${razorpayKeyId()}:${razorpayKeySecret()}`).toString(
    'base64',
  )
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
  if (!isRazorpayConfigured()) {
    return {
      planId: null,
      warning:
        'Package saved without a Razorpay Plan. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET so merchants can subscribe.',
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

export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = razorpayWebhookSecret()
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

export function verifyCheckoutSignature(args: {
  subscriptionId: string
  paymentId: string
  signature: string
}): boolean {
  const secret = razorpayKeySecret()
  if (!secret) return false
  const payload = `${args.paymentId}|${args.subscriptionId}`
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(args.signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
