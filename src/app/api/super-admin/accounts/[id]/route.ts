import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { cancelRazorpaySubscription } from '@/lib/billing/razorpay'
import { startOfUtcMonth } from '@/lib/billing/entitlements'
import { parseBillingInterval, periodEndFromNow } from '@/lib/billing/interval'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface Params {
  params: Promise<{ id: string }>
}

async function loadBillingHistory(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
  accountId: string,
) {
  const { data } = await admin
    .from('billing_webhook_events')
    .select('provider_event_id, event_type, processed_at, payload')
    .order('processed_at', { ascending: false })
    .limit(80)

  return (data ?? [])
    .filter((row) => {
      const payload = row.payload as {
        payload?: {
          subscription?: { entity?: { notes?: Record<string, string> } }
          payment?: { entity?: { notes?: Record<string, string> } }
        }
      }
      const notes =
        payload?.payload?.subscription?.entity?.notes ??
        payload?.payload?.payment?.entity?.notes ??
        {}
      return notes.account_id === accountId
    })
    .slice(0, 20)
    .map((row) => ({
      id: row.provider_event_id,
      event_type: row.event_type,
      processed_at: row.processed_at,
    }))
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:account:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const { data: account, error } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, status, ai_enabled, created_at, default_currency')
      .eq('id', id)
      .maybeSingle()
    if (error || !account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const [members, wa, shop, sub, usage] = await Promise.all([
      admin
        .from('profiles')
        .select('user_id, full_name, email, account_role, avatar_url')
        .eq('account_id', id),
      admin
        .from('whatsapp_config')
        .select('phone_number_id, waba_id, status, verify_token, access_token')
        .eq('account_id', id)
        .maybeSingle(),
      admin
        .from('shopify_configs')
        .select('shop_domain, shop_name, is_active, access_token, primary_domain, currency')
        .eq('account_id', id)
        .maybeSingle(),
      admin
        .from('account_subscriptions')
        .select(
          'status, source, current_period_end, cancel_at_period_end, razorpay_subscription_id, package_id, billing_packages (id, name, slug)',
        )
        .eq('account_id', id)
        .maybeSingle(),
      admin
        .from('ai_usage_log')
        .select('total_tokens')
        .eq('account_id', id)
        .gte('created_at', startOfUtcMonth().toISOString()),
    ])

    const pkgRaw = sub.data?.billing_packages
    const pkg = Array.isArray(pkgRaw) ? pkgRaw[0] : pkgRaw
    const memberRows = members.data ?? []
    const owner = memberRows.find((m) => m.account_role === 'owner') ?? null

    return NextResponse.json({
      account,
      owner: owner
        ? {
            user_id: owner.user_id,
            full_name: owner.full_name,
            email: owner.email,
            avatar_url: owner.avatar_url,
          }
        : null,
      members: memberRows,
      whatsapp: wa.data
        ? {
            phone_number_id: wa.data.phone_number_id,
            waba_id: wa.data.waba_id,
            status: wa.data.status,
            has_token: Boolean(wa.data.access_token),
            has_verify_token: Boolean(wa.data.verify_token),
          }
        : null,
      shopify: shop.data
        ? {
            shop_domain: shop.data.shop_domain,
            shop_name: shop.data.shop_name,
            is_active: shop.data.is_active,
            primary_domain: shop.data.primary_domain,
            currency: shop.data.currency,
            has_token: Boolean(shop.data.access_token),
          }
        : null,
      subscription: sub.data
        ? {
            status: sub.data.status,
            source: sub.data.source,
            current_period_end: sub.data.current_period_end,
            cancel_at_period_end: sub.data.cancel_at_period_end,
            package_id: sub.data.package_id,
            package_name: pkg?.name ?? null,
            package_slug: pkg?.slug ?? null,
          }
        : null,
      tokens_this_month: (usage.data ?? []).reduce(
        (sum, row) => sum + (row.total_tokens ?? 0),
        0,
      ),
      billing_events: await loadBillingHistory(admin, id),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:account-patch:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name || name.length > 80) {
        return NextResponse.json({ error: 'Invalid account name' }, { status: 400 })
      }
      patch.name = name
    }
    if (body.status === 'active' || body.status === 'suspended') {
      patch.status = body.status
    }
    if (typeof body.ai_enabled === 'boolean') {
      patch.ai_enabled = body.ai_enabled
    }

    if (Object.keys(patch).length) {
      const { error } = await admin.from('accounts').update(patch).eq('id', id)
      if (error) {
        console.error('[super-admin/accounts PATCH]', error)
        return NextResponse.json({ error: 'Failed to update account' }, { status: 500 })
      }
    }

    if (typeof body.package_id === 'string' && body.package_id) {
      const { data: existing } = await admin
        .from('account_subscriptions')
        .select('razorpay_subscription_id')
        .eq('account_id', id)
        .maybeSingle()
      if (existing?.razorpay_subscription_id) {
        try {
          await cancelRazorpaySubscription(existing.razorpay_subscription_id, false)
        } catch (err) {
          console.error('[super-admin] cancel razorpay on comp assign:', err)
        }
      }
      const { data: pkg } = await admin
        .from('billing_packages')
        .select('interval, is_free, amount_paise')
        .eq('id', body.package_id)
        .maybeSingle()
      const periodEnd =
        pkg && !pkg.is_free && pkg.amount_paise > 0
          ? periodEndFromNow(parseBillingInterval(pkg.interval))
          : null
      const { error: subErr } = await admin.from('account_subscriptions').upsert(
        {
          account_id: id,
          package_id: body.package_id,
          status: 'active',
          source: 'comp',
          razorpay_subscription_id: null,
          cancel_at_period_end: false,
          current_period_end: periodEnd,
        },
        { onConflict: 'account_id' },
      )
      if (subErr) {
        console.error('[super-admin] assign package:', subErr)
        return NextResponse.json({ error: 'Failed to assign package' }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
