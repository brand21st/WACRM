import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { BILLING_PACKAGE_COLUMNS, mapPackageRow } from '@/lib/billing/entitlements'
import { parseBillingInterval } from '@/lib/billing/interval'
import { maybeSyncRazorpayPlan } from '@/lib/billing/razorpay'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface Params {
  params: Promise<{ id: string }>
}

async function subscriberCount(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
  packageId: string,
) {
  const { count, error } = await admin
    .from('account_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('package_id', packageId)
  if (error) throw error
  return count ?? 0
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const { admin } = await requirePlatformAdmin()
    const { id } = await params
    const { data, error } = await admin
      .from('billing_packages')
      .select(BILLING_PACKAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'Failed to load package' }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    return NextResponse.json({
      package: {
        ...mapPackageRow(data),
        subscriberCount: await subscriberCount(admin, id),
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:pkg-del:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params

    const { data: existing, error: loadErr } = await admin
      .from('billing_packages')
      .select('id, slug, is_free')
      .eq('id', id)
      .maybeSingle()
    if (loadErr || !existing) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }
    if (existing.slug === 'free' || existing.is_free) {
      return NextResponse.json(
        { error: 'The Free package cannot be deleted' },
        { status: 409 },
      )
    }

    const usedBy = await subscriberCount(admin, id)
    if (usedBy > 0) {
      return NextResponse.json(
        {
          error: `This package is assigned to ${usedBy} account${usedBy === 1 ? '' : 's'}. Disable it instead.`,
        },
        { status: 409 },
      )
    }

    const { error } = await admin.from('billing_packages').delete().eq('id', id)
    if (error) {
      console.error('[super-admin/packages DELETE]', error)
      if (error.code === '23503') {
        return NextResponse.json(
          { error: 'This package is assigned to accounts. Disable it instead.' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'Failed to delete package' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:pkg-patch:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    const { data: existing, error: loadErr } = await admin
      .from('billing_packages')
      .select(BILLING_PACKAGE_COLUMNS)
      .eq('id', id)
      .maybeSingle()
    if (loadErr || !existing) {
      return NextResponse.json({ error: 'Package not found' }, { status: 404 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (typeof body.description === 'string') {
      patch.description = body.description.trim() || null
    }
    if (body.interval === 'month' || body.interval === 'quarter' || body.interval === 'year') {
      patch.interval = parseBillingInterval(body.interval)
    }
    if (body.amount_paise != null) {
      patch.amount_paise = Math.max(0, Math.floor(Number(body.amount_paise) || 0))
    }
    if (typeof body.is_active === 'boolean') patch.is_active = body.is_active
    if (typeof body.ai_enabled === 'boolean') patch.ai_enabled = body.ai_enabled
    if ('ai_monthly_token_cap' in body) {
      patch.ai_monthly_token_cap =
        body.ai_monthly_token_cap == null || body.ai_monthly_token_cap === ''
          ? null
          : Math.max(1, Math.floor(Number(body.ai_monthly_token_cap)))
    }
    if (body.max_seats != null) patch.max_seats = Math.max(1, Math.floor(Number(body.max_seats)))
    if (typeof body.calling_enabled === 'boolean') patch.calling_enabled = body.calling_enabled
    if (typeof body.call_recording_enabled === 'boolean') {
      patch.call_recording_enabled = body.call_recording_enabled
    }
    if (typeof body.call_forwarding_enabled === 'boolean') {
      patch.call_forwarding_enabled = body.call_forwarding_enabled
    }
    patch.whatsapp_enabled = true
    if ('whatsapp_monthly_message_cap' in body) {
      patch.whatsapp_monthly_message_cap =
        body.whatsapp_monthly_message_cap == null ||
        body.whatsapp_monthly_message_cap === ''
          ? null
          : Math.max(1, Math.floor(Number(body.whatsapp_monthly_message_cap)))
    }
    if (typeof body.shopify_enabled === 'boolean') patch.shopify_enabled = body.shopify_enabled
    if (body.sort_order != null) patch.sort_order = Number(body.sort_order) || 0

    const nextAmount = (patch.amount_paise as number | undefined) ?? existing.amount_paise
    const nextInterval = (patch.interval as string | undefined) ?? existing.interval
    const nextName = (patch.name as string | undefined) ?? existing.name
    const isFree = nextAmount === 0
    patch.is_free = isFree
    if (isFree) patch.amount_paise = 0

    const priceChanged =
      nextAmount !== existing.amount_paise || nextInterval !== existing.interval
    let razorpayWarning: string | undefined
    if (!isFree && priceChanged) {
      const synced = await maybeSyncRazorpayPlan({
        name: nextName,
        description:
          (patch.description as string | null | undefined) ?? existing.description,
        amountPaise: nextAmount,
        currency: existing.currency,
        interval: parseBillingInterval(nextInterval),
      })
      if (synced.planId) patch.razorpay_plan_id = synced.planId
      razorpayWarning = synced.warning
    }

    const { data, error } = await admin
      .from('billing_packages')
      .update(patch)
      .eq('id', id)
      .select(BILLING_PACKAGE_COLUMNS)
      .single()
    if (error) {
      console.error('[super-admin/packages PATCH]', error)
      return NextResponse.json({ error: 'Failed to update package' }, { status: 500 })
    }
    return NextResponse.json({ package: mapPackageRow(data), warning: razorpayWarning })
  } catch (err) {
    return toErrorResponse(err)
  }
}
