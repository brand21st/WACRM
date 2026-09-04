import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  cancelRazorpaySubscription,
  createRazorpayCustomer,
  createRazorpaySubscription,
  razorpayKeyId,
} from '@/lib/billing/razorpay'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export async function POST(request: Request) {
  try {
    const { accountId, userId, supabase, account } = await requireRole('admin')
    const limit = checkRateLimit(`billing:subscribe:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as { packageId?: unknown } | null
    const packageId = typeof body?.packageId === 'string' ? body.packageId : ''
    if (!packageId) {
      return NextResponse.json({ error: 'packageId is required' }, { status: 400 })
    }

    const { data: pkg, error: pkgErr } = await supabase
      .from('billing_packages')
      .select('id, name, is_free, is_active, razorpay_plan_id, amount_paise')
      .eq('id', packageId)
      .maybeSingle()
    if (pkgErr || !pkg || !pkg.is_active) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    const db = supabaseAdmin()
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('user_id', userId)
      .maybeSingle()

    if (pkg.is_free || pkg.amount_paise === 0) {
      const { data: existing } = await db
        .from('account_subscriptions')
        .select('razorpay_subscription_id')
        .eq('account_id', accountId)
        .maybeSingle()
      if (existing?.razorpay_subscription_id) {
        try {
          await cancelRazorpaySubscription(existing.razorpay_subscription_id, false)
        } catch (err) {
          console.error('[billing/subscribe] cancel prior:', err)
        }
      }
      const { error } = await db.from('account_subscriptions').upsert(
        {
          account_id: accountId,
          package_id: pkg.id,
          status: 'active',
          source: 'comp',
          razorpay_subscription_id: null,
          cancel_at_period_end: false,
        },
        { onConflict: 'account_id' },
      )
      if (error) {
        return NextResponse.json({ error: 'Failed to switch plan' }, { status: 500 })
      }
      return NextResponse.json({ activated: true })
    }

    if (!pkg.razorpay_plan_id) {
      return NextResponse.json(
        { error: 'This package is not ready for checkout yet' },
        { status: 400 },
      )
    }

    const { data: existing } = await db
      .from('account_subscriptions')
      .select('razorpay_subscription_id, razorpay_customer_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existing?.razorpay_subscription_id) {
      try {
        await cancelRazorpaySubscription(existing.razorpay_subscription_id, false)
      } catch (err) {
        console.error('[billing/subscribe] cancel prior paid:', err)
      }
    }

    let customerId = existing?.razorpay_customer_id ?? null
    if (!customerId) {
      customerId = await createRazorpayCustomer({
        name: profile?.full_name || account.name,
        email: profile?.email || '',
        notes: { account_id: accountId },
      })
    }

    const sub = await createRazorpaySubscription({
      planId: pkg.razorpay_plan_id,
      customerId,
      notes: { account_id: accountId, package_id: pkg.id },
    })

    await db.from('account_subscriptions').upsert(
      {
        account_id: accountId,
        package_id: pkg.id,
        status: 'past_due',
        source: 'checkout',
        razorpay_subscription_id: sub.id,
        razorpay_customer_id: customerId,
        cancel_at_period_end: false,
      },
      { onConflict: 'account_id' },
    )

    return NextResponse.json({
      checkout: {
        key: await razorpayKeyId(),
        subscription_id: sub.id,
        name: 'Vachat.in',
        description: pkg.name,
        prefill: {
          name: profile?.full_name ?? '',
          email: profile?.email ?? '',
        },
        notes: { account_id: accountId, package_id: pkg.id },
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
