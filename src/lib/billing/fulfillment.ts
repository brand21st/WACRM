import { supabaseAdmin } from '@/lib/ai/admin-client'
import type { SubscriptionStatus } from './types'

interface RazorpayEntity {
  id?: string
  notes?: Record<string, string | undefined>
  customer_id?: string
  current_end?: number
  current_start?: number
  status?: string
  plan_id?: string
}

function readNotes(payload: unknown): Record<string, string> {
  const root = payload as {
    payload?: {
      subscription?: { entity?: RazorpayEntity }
      payment?: { entity?: { notes?: Record<string, string> } }
    }
  }
  const notes =
    root.payload?.subscription?.entity?.notes ??
    root.payload?.payment?.entity?.notes ??
    {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(notes)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}

function readSubscription(payload: unknown): RazorpayEntity | null {
  const root = payload as {
    payload?: { subscription?: { entity?: RazorpayEntity } }
  }
  return root.payload?.subscription?.entity ?? null
}

function periodEndIso(entity: RazorpayEntity | null): string | null {
  if (!entity?.current_end) return null
  return new Date(entity.current_end * 1000).toISOString()
}

export function mapRazorpayStatus(eventType: string, entityStatus?: string): SubscriptionStatus {
  if (
    eventType === 'subscription.cancelled' ||
    eventType === 'subscription.completed'
  ) {
    return 'cancelled'
  }
  if (eventType === 'subscription.halted' || eventType === 'payment.failed') {
    return 'past_due'
  }
  if (entityStatus === 'expired') return 'expired'
  if (entityStatus === 'cancelled' || entityStatus === 'completed') return 'cancelled'
  if (entityStatus === 'halted' || entityStatus === 'pending') return 'past_due'
  return 'active'
}

export async function recordWebhookEvent(
  providerEventId: string,
  eventType: string,
  payload: unknown,
): Promise<boolean> {
  const { error } = await supabaseAdmin()
    .from('billing_webhook_events')
    .insert({
      provider_event_id: providerEventId,
      event_type: eventType,
      payload,
    })
  if (error) {
    if (error.code === '23505') return false
    console.error('[billing webhook] persist failed:', error)
    throw error
  }
  return true
}

export async function fulfillRazorpayEvent(
  eventType: string,
  payload: unknown,
): Promise<void> {
  const notes = readNotes(payload)
  const entity = readSubscription(payload)
  const accountId = notes.account_id
  const packageId = notes.package_id
  if (!accountId) {
    console.warn('[billing webhook] missing account_id notes on', eventType)
    return
  }

  const status = mapRazorpayStatus(eventType, entity?.status)
  const patch: Record<string, unknown> = {
    status,
    source: 'checkout',
    razorpay_subscription_id: entity?.id ?? null,
    razorpay_customer_id: entity?.customer_id ?? null,
    current_period_end: periodEndIso(entity),
    cancel_at_period_end:
      eventType === 'subscription.cancelled' && status === 'cancelled'
        ? true
        : undefined,
  }
  if (packageId) patch.package_id = packageId
  if (patch.cancel_at_period_end === undefined) {
    delete patch.cancel_at_period_end
  }

  const { data: existing } = await supabaseAdmin()
    .from('account_subscriptions')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabaseAdmin()
      .from('account_subscriptions')
      .update(patch)
      .eq('account_id', accountId)
    if (error) throw error
    return
  }

  if (!packageId) return
  const { error } = await supabaseAdmin().from('account_subscriptions').insert({
    account_id: accountId,
    package_id: packageId,
    ...patch,
  })
  if (error) throw error
}
