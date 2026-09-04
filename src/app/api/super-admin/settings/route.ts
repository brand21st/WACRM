import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { BILLING_PACKAGE_COLUMNS, mapPackageRow } from '@/lib/billing/entitlements'
import { parseBillingInterval } from '@/lib/billing/interval'
import {
  __resetPlatformBillingSettingsCache,
  loadPlatformBillingSettings,
  resolveBillingCredentials,
} from '@/lib/billing/platform-settings'
import {
  isValidRazorpayKeyId,
  maybeSyncRazorpayPlan,
  razorpayKeyMode,
  validateRazorpayKeys,
} from '@/lib/billing/razorpay'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function unsyncedPaidCount(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
) {
  const { data, error } = await admin
    .from('billing_packages')
    .select('id, razorpay_plan_id, is_free, amount_paise')
  if (error) {
    console.error('[super-admin/settings] unsynced count', error)
    return 0
  }
  return (data ?? []).filter(
    (row) => !row.is_free && row.amount_paise > 0 && !row.razorpay_plan_id,
  ).length
}

async function settingsPayload(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
) {
  const [{ data, error }, creds] = await Promise.all([
    admin
      .from('platform_billing_settings')
      .select('razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret')
      .eq('id', 1)
      .maybeSingle(),
    resolveBillingCredentials(),
  ])
  if (error) throw error
  return {
    razorpay_key_id: data?.razorpay_key_id ?? '',
    has_razorpay_secret: Boolean(data?.razorpay_key_secret),
    has_razorpay_webhook_secret: Boolean(data?.razorpay_webhook_secret),
    configured: creds.configured,
    source: creds.source,
    mode: razorpayKeyMode(creds.keyId),
    active_key_id: creds.configured ? creds.keyId : '',
    unsynced_paid_count: await unsyncedPaidCount(admin),
  }
}

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin()
    return NextResponse.json(await settingsPayload(admin))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:settings:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return bad('Invalid body')

    const { data: existing, error: loadErr } = await admin
      .from('platform_billing_settings')
      .select('razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret')
      .eq('id', 1)
      .maybeSingle()
    if (loadErr) {
      console.error('[super-admin/settings PUT] load', loadErr)
      return NextResponse.json({ error: 'Failed to load billing settings' }, { status: 500 })
    }

    const patch: Record<string, unknown> = {}

    if ('razorpay_key_id' in body) {
      if (body.razorpay_key_id === null || body.razorpay_key_id === '') {
        patch.razorpay_key_id = null
      } else if (typeof body.razorpay_key_id === 'string') {
        const keyId = body.razorpay_key_id.trim()
        if (!isValidRazorpayKeyId(keyId)) {
          return bad('Razorpay Key ID must start with rzp_test_ or rzp_live_')
        }
        patch.razorpay_key_id = keyId
      } else {
        return bad('Invalid razorpay_key_id')
      }
    }

    if (body.razorpay_key_secret === null) {
      patch.razorpay_key_secret = null
    } else if (typeof body.razorpay_key_secret === 'string' && body.razorpay_key_secret.trim()) {
      patch.razorpay_key_secret = encrypt(body.razorpay_key_secret.trim())
    }

    if (body.razorpay_webhook_secret === null) {
      patch.razorpay_webhook_secret = null
    } else if (
      typeof body.razorpay_webhook_secret === 'string' &&
      body.razorpay_webhook_secret.trim()
    ) {
      patch.razorpay_webhook_secret = encrypt(body.razorpay_webhook_secret.trim())
    }

    const stored = await loadPlatformBillingSettings()
    const nextKeyId =
      'razorpay_key_id' in patch
        ? ((patch.razorpay_key_id as string | null) ?? '')
        : (existing?.razorpay_key_id ?? '')
    const nextSecret =
      body.razorpay_key_secret === null
        ? ''
        : typeof body.razorpay_key_secret === 'string' && body.razorpay_key_secret.trim()
          ? body.razorpay_key_secret.trim()
          : (stored?.razorpayKeySecret ?? '')
    const pairChanged =
      'razorpay_key_id' in patch ||
      body.razorpay_key_secret === null ||
      (typeof body.razorpay_key_secret === 'string' && Boolean(body.razorpay_key_secret.trim()))

    if (pairChanged && nextKeyId && nextSecret) {
      if (!isValidRazorpayKeyId(nextKeyId)) {
        return bad('Razorpay Key ID must start with rzp_test_ or rzp_live_')
      }
      try {
        await validateRazorpayKeys(nextKeyId, nextSecret)
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Razorpay rejected these keys' },
          { status: 400 },
        )
      }
    }

    const { error } = await admin
      .from('platform_billing_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    if (error) {
      console.error('[super-admin/settings PUT]', error)
      return NextResponse.json({ error: 'Failed to save billing settings' }, { status: 500 })
    }
    __resetPlatformBillingSettingsCache()
    return NextResponse.json({ ok: true, ...(await settingsPayload(admin)) })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST() {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:sync-plans:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const creds = await resolveBillingCredentials()
    if (!creds.configured) {
      return NextResponse.json(
        { error: 'Add Razorpay keys before syncing plans' },
        { status: 400 },
      )
    }

    const { data, error } = await admin
      .from('billing_packages')
      .select(BILLING_PACKAGE_COLUMNS)
    if (error) {
      return NextResponse.json({ error: 'Failed to load packages' }, { status: 500 })
    }

    const pending = (data ?? []).filter(
      (row) => !row.is_free && row.amount_paise > 0 && !row.razorpay_plan_id,
    )

    const results: Array<{ id: string; name: string; planId: string | null; error?: string }> = []
    for (const row of pending) {
      const pkg = mapPackageRow(row)
      try {
        const synced = await maybeSyncRazorpayPlan({
          name: pkg.name,
          description: pkg.description,
          amountPaise: pkg.amountPaise,
          currency: pkg.currency,
          interval: parseBillingInterval(pkg.interval),
        })
        if (synced.planId) {
          const { error: updateErr } = await admin
            .from('billing_packages')
            .update({ razorpay_plan_id: synced.planId })
            .eq('id', pkg.id)
          if (updateErr) throw updateErr
        }
        results.push({
          id: pkg.id,
          name: pkg.name,
          planId: synced.planId,
          error: synced.warning,
        })
      } catch (err) {
        results.push({
          id: pkg.id,
          name: pkg.name,
          planId: null,
          error: err instanceof Error ? err.message : 'Sync failed',
        })
      }
    }

    const synced = results.filter((row) => row.planId).length
    return NextResponse.json({
      synced,
      failed: results.filter((row) => !row.planId).length,
      results,
      unsynced_paid_count: await unsyncedPaidCount(admin),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
