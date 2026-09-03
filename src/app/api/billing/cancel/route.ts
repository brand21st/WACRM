import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { cancelRazorpaySubscription } from '@/lib/billing/razorpay'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function POST() {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`billing:cancel:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const db = supabaseAdmin()
    const { data: sub } = await db
      .from('account_subscriptions')
      .select('razorpay_subscription_id, source')
      .eq('account_id', accountId)
      .maybeSingle()

    if (sub?.razorpay_subscription_id) {
      await cancelRazorpaySubscription(sub.razorpay_subscription_id, true)
    }

    const { error } = await db
      .from('account_subscriptions')
      .update({ cancel_at_period_end: true, status: 'cancelled' })
      .eq('account_id', accountId)
    if (error) {
      return NextResponse.json({ error: 'Failed to cancel' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
