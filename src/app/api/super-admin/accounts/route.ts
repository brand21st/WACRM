import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { isAccountStatus } from '@/lib/auth/account-status'
import { isMerchantAccountOwner, requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { startOfUtcMonth } from '@/lib/billing/entitlements'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:accounts:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const status = url.searchParams.get('status')

    let query = admin
      .from('accounts')
      .select('id, name, owner_user_id, status, ai_enabled, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (isAccountStatus(status)) {
      query = query.eq('status', status)
    }
    const { data: accounts, error } = await query
    if (error) {
      console.error('[super-admin/accounts] list error:', error)
      return NextResponse.json({ error: 'Failed to list accounts' }, { status: 500 })
    }

    const rows = accounts ?? []
    const ownerIds = [...new Set(rows.map((a) => a.owner_user_id).filter(Boolean))]
    const accountIds = rows.map((a) => a.id)

    const [owners, profiles, wa, shop, subs, usage] = await Promise.all([
      ownerIds.length
        ? admin.from('profiles').select('user_id, email, full_name').in('user_id', ownerIds)
        : Promise.resolve({ data: [] as { user_id: string; email: string; full_name: string | null }[] }),
      accountIds.length
        ? admin.from('profiles').select('account_id').in('account_id', accountIds)
        : Promise.resolve({ data: [] as { account_id: string }[] }),
      accountIds.length
        ? admin
            .from('whatsapp_config')
            .select('account_id, status')
            .in('account_id', accountIds)
        : Promise.resolve({ data: [] as { account_id: string; status: string }[] }),
      accountIds.length
        ? admin
            .from('shopify_configs')
            .select('account_id, is_active')
            .in('account_id', accountIds)
        : Promise.resolve({ data: [] as { account_id: string; is_active: boolean }[] }),
      accountIds.length
        ? admin
            .from('account_subscriptions')
            .select('account_id, status, current_period_start, current_period_end, billing_packages (name, slug)')
            .in('account_id', accountIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      accountIds.length
        ? admin
            .from('ai_usage_log')
            .select('account_id, total_tokens')
            .in('account_id', accountIds)
            .gte('created_at', startOfUtcMonth().toISOString())
        : Promise.resolve({ data: [] as { account_id: string; total_tokens: number }[] }),
    ])

    const ownerByUser = new Map(
      (owners.data ?? []).map((p) => [p.user_id, p]),
    )
    const memberCount = new Map<string, number>()
    for (const p of profiles.data ?? []) {
      memberCount.set(p.account_id, (memberCount.get(p.account_id) ?? 0) + 1)
    }
    const waByAccount = new Map((wa.data ?? []).map((r) => [r.account_id, r.status]))
    const shopByAccount = new Map(
      (shop.data ?? []).map((r) => [r.account_id, r.is_active]),
    )
    const subByAccount = new Map(
      (subs.data ?? []).map((s) => {
        const row = s as {
          account_id: string
          status: string
          current_period_start: string | null
          current_period_end: string | null
          billing_packages: { name: string; slug: string } | { name: string; slug: string }[] | null
        }
        const pkg = Array.isArray(row.billing_packages)
          ? row.billing_packages[0]
          : row.billing_packages
        return [
          row.account_id,
          {
            status: row.status,
            packageName: pkg?.name ?? null,
            slug: pkg?.slug ?? null,
            periodStart: row.current_period_start ?? null,
            periodEnd: row.current_period_end ?? null,
          },
        ]
      }),
    )
    const tokensByAccount = new Map<string, number>()
    for (const row of usage.data ?? []) {
      tokensByAccount.set(
        row.account_id,
        (tokensByAccount.get(row.account_id) ?? 0) + (row.total_tokens ?? 0),
      )
    }

    const list = rows
      .filter((a) => isMerchantAccountOwner(a.owner_user_id, userId))
      .map((a) => {
        const owner = ownerByUser.get(a.owner_user_id)
        return {
          id: a.id,
          name: a.name,
          status: a.status,
          ai_enabled: a.ai_enabled,
          created_at: a.created_at,
          owner_email: owner?.email ?? null,
          owner_name: owner?.full_name ?? null,
          members: memberCount.get(a.id) ?? 0,
          whatsapp_connected: waByAccount.get(a.id) === 'connected',
          shopify_connected: shopByAccount.get(a.id) === true,
          package_name: subByAccount.get(a.id)?.packageName ?? null,
          subscription_status: subByAccount.get(a.id)?.status ?? null,
          period_start: subByAccount.get(a.id)?.periodStart ?? null,
          period_end: subByAccount.get(a.id)?.periodEnd ?? null,
          tokens_30d: tokensByAccount.get(a.id) ?? 0,
        }
      })
      .filter((a) => {
        if (!q) return true
        return (
          a.name.toLowerCase().includes(q) ||
          (a.owner_email ?? '').toLowerCase().includes(q) ||
          (a.owner_name ?? '').toLowerCase().includes(q)
        )
      })

    return NextResponse.json({ accounts: list })
  } catch (err) {
    return toErrorResponse(err)
  }
}
