import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { startOfUtcMonth } from '@/lib/billing/entitlements'
import { monthlyRecurringPaise, parseBillingInterval } from '@/lib/billing/interval'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET() {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:overview:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const monthStart = startOfUtcMonth().toISOString()

    const [
      accounts,
      suspended,
      platform,
      subs,
      packages,
      usage,
    ] = await Promise.all([
      admin.from('accounts').select('id', { count: 'exact', head: true }),
      admin
        .from('accounts')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'suspended'),
      admin
        .from('platform_ai_settings')
        .select('openai_api_key, anthropic_api_key, global_ai_enabled')
        .eq('id', 1)
        .maybeSingle(),
      admin
        .from('account_subscriptions')
        .select('package_id, status, source')
        .in('status', ['active', 'past_due']),
      admin
        .from('billing_packages')
        .select('id, amount_paise, interval, is_free'),
      admin
        .from('ai_usage_log')
        .select('total_tokens')
        .gte('created_at', monthStart),
    ])

    const pkgById = new Map(
      (packages.data ?? []).map((p) => [p.id, p]),
    )
    let mrrPaise = 0
    let activeSubs = 0
    for (const sub of subs.data ?? []) {
      if (sub.status !== 'active' && sub.status !== 'past_due') continue
      activeSubs += 1
      const pkg = pkgById.get(sub.package_id)
      if (!pkg || pkg.is_free) continue
      mrrPaise += monthlyRecurringPaise(
        pkg.amount_paise,
        parseBillingInterval(pkg.interval),
      )
    }

    const tokensThisMonth = (usage.data ?? []).reduce(
      (sum, row) => sum + (row.total_tokens ?? 0),
      0,
    )

    return NextResponse.json({
      accounts: accounts.count ?? 0,
      suspended: suspended.count ?? 0,
      ai_configured: Boolean(
        platform.data?.openai_api_key || platform.data?.anthropic_api_key,
      ),
      global_ai_enabled: platform.data?.global_ai_enabled !== false,
      active_subscriptions: activeSubs,
      mrr_paise: mrrPaise,
      tokens_this_month: tokensThisMonth,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
