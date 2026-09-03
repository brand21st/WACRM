import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { BILLING_PACKAGE_COLUMNS, mapPackageRow } from '@/lib/billing/entitlements'
import { parseBillingInterval } from '@/lib/billing/interval'
import { maybeSyncRazorpayPlan } from '@/lib/billing/razorpay'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function readPackageBody(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) throw new Error('name is required')
  const interval = parseBillingInterval(body.interval)
  const amountPaise = Math.max(0, Math.floor(Number(body.amount_paise) || 0))
  const isFree = amountPaise === 0 || body.is_free === true
  return {
    name,
    slug: typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim() : slugify(name),
    description:
      typeof body.description === 'string' ? body.description.trim() || null : null,
    interval,
    amount_paise: isFree ? 0 : amountPaise,
    currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim() : 'INR',
    is_active: body.is_active !== false,
    is_free: isFree,
    sort_order: Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    ai_enabled: body.ai_enabled === true,
    ai_monthly_token_cap:
      body.ai_monthly_token_cap == null || body.ai_monthly_token_cap === ''
        ? null
        : Math.max(1, Math.floor(Number(body.ai_monthly_token_cap))),
    max_seats: Math.max(1, Math.floor(Number(body.max_seats) || 1)),
    calling_enabled: body.calling_enabled === true,
    call_recording_enabled: body.call_recording_enabled === true,
    call_forwarding_enabled: body.call_forwarding_enabled === true,
    whatsapp_enabled: true,
    whatsapp_monthly_message_cap:
      body.whatsapp_monthly_message_cap == null || body.whatsapp_monthly_message_cap === ''
        ? null
        : Math.max(1, Math.floor(Number(body.whatsapp_monthly_message_cap))),
    shopify_enabled: body.shopify_enabled === true,
  }
}

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin()
    const [{ data, error }, subs] = await Promise.all([
      admin.from('billing_packages').select(BILLING_PACKAGE_COLUMNS).order('sort_order').order('name'),
      admin.from('account_subscriptions').select('package_id'),
    ])
    if (error) return NextResponse.json({ error: 'Failed to load packages' }, { status: 500 })
    const counts = new Map<string, number>()
    for (const row of subs.data ?? []) {
      const packageId = (row as { package_id: string }).package_id
      counts.set(packageId, (counts.get(packageId) ?? 0) + 1)
    }
    return NextResponse.json({
      packages: (data ?? []).map((row) => ({
        ...mapPackageRow(row),
        subscriberCount: counts.get(row.id) ?? 0,
      })),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:pkg:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

    let row
    try {
      row = readPackageBody(body)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Invalid package' },
        { status: 400 },
      )
    }

    let razorpayPlanId: string | null = null
    let razorpayWarning: string | undefined
    if (!row.is_free && row.amount_paise > 0) {
      const synced = await maybeSyncRazorpayPlan({
        name: row.name,
        description: row.description,
        amountPaise: row.amount_paise,
        currency: row.currency,
        interval: row.interval,
      })
      razorpayPlanId = synced.planId
      razorpayWarning = synced.warning
    }

    const { data, error } = await admin
      .from('billing_packages')
      .insert({ ...row, razorpay_plan_id: razorpayPlanId })
      .select(BILLING_PACKAGE_COLUMNS)
      .single()
    if (error) {
      console.error('[super-admin/packages POST]', error)
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A package with this name already exists' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: 'Failed to create package' }, { status: 500 })
    }
    return NextResponse.json(
      { package: mapPackageRow(data), warning: razorpayWarning },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
