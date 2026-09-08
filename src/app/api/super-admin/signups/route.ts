import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { isMerchantAccountOwner, requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { subscriptionIsLive } from '@/lib/billing/entitlements'
import type { SubscriptionStatus } from '@/lib/billing/types'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  fillSignupBuckets,
  parseSignupGrain,
  parseSignupSort,
} from '@/lib/super-admin/signup-buckets'

const SUB_STATUSES = new Set<SubscriptionStatus>([
  'active',
  'past_due',
  'cancelled',
  'expired',
])

function isLiveSubscription(
  status: string | null | undefined,
  periodEnd: string | null | undefined,
): boolean {
  if (!status || !SUB_STATUSES.has(status as SubscriptionStatus)) return false
  return subscriptionIsLive(status as SubscriptionStatus, periodEnd ?? null)
}

export async function GET(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(
      `super-admin:signups:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const url = new URL(request.url)
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase()
    const grain = parseSignupGrain(url.searchParams.get('grain'))
    const sort = parseSignupSort(url.searchParams.get('sort'))

    const { data: accounts, error } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, status, created_at')
      .neq('owner_user_id', userId)
      .order('created_at', { ascending: sort === 'oldest' })
      .limit(1000)
    if (error) {
      console.error('[super-admin/signups] list error:', error)
      return NextResponse.json({ error: 'Failed to list signups' }, { status: 500 })
    }

    const rows = (accounts ?? []).filter((a) =>
      isMerchantAccountOwner(a.owner_user_id, userId),
    )
    const ownerIds = [...new Set(rows.map((a) => a.owner_user_id).filter(Boolean))]
    const accountIds = rows.map((a) => a.id)

    const [owners, subs] = await Promise.all([
      ownerIds.length
        ? admin
            .from('profiles')
            .select('user_id, email, full_name')
            .in('user_id', ownerIds)
        : Promise.resolve({
            data: [] as {
              user_id: string
              email: string
              full_name: string | null
            }[],
          }),
      accountIds.length
        ? admin
            .from('account_subscriptions')
            .select(
              'account_id, status, current_period_end, billing_packages (name)',
            )
            .in('account_id', accountIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ])

    const ownerByUser = new Map((owners.data ?? []).map((p) => [p.user_id, p]))
    const subByAccount = new Map(
      (subs.data ?? []).map((s) => {
        const row = s as {
          account_id: string
          status: string
          current_period_end: string | null
          billing_packages: { name: string } | { name: string }[] | null
        }
        const pkg = Array.isArray(row.billing_packages)
          ? row.billing_packages[0]
          : row.billing_packages
        return [
          row.account_id,
          {
            status: row.status,
            packageName: pkg?.name ?? null,
            periodEnd: row.current_period_end ?? null,
          },
        ] as const
      }),
    )

    const list = rows
      .map((a) => {
        const owner = ownerByUser.get(a.owner_user_id)
        const sub = subByAccount.get(a.id)
        return {
          id: a.id,
          name: a.name,
          created_at: a.created_at as string,
          owner_email: owner?.email ?? null,
          owner_name: owner?.full_name ?? null,
          package_name: sub?.packageName ?? null,
          subscription_status: sub?.status ?? null,
          period_end: sub?.periodEnd ?? null,
          active: isLiveSubscription(sub?.status, sub?.periodEnd),
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

    const active = list.filter((row) => row.active).length

    return NextResponse.json({
      totals: {
        signups: list.length,
        active,
        inactive: list.length - active,
      },
      buckets: fillSignupBuckets(
        list.map((row) => row.created_at),
        grain,
      ),
      rows: list,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
