import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { daysAgoStart } from '@/lib/dashboard/date-utils'
import { aggregateCallAnalytics, type AnalyticsCallRow } from '@/lib/calling/analytics'

const DEFAULT_DAYS = 30
const MAX_ROWS = 5_000

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('viewer')
    const url = new URL(request.url)
    const rawDays = Number(url.searchParams.get('days'))
    const days =
      Number.isFinite(rawDays) && rawDays >= 1
        ? Math.min(90, Math.floor(rawDays))
        : DEFAULT_DAYS

    const since = daysAgoStart(days - 1)

    const { data, error } = await supabase
      .from('calls')
      .select(
        'id, status, duration_seconds, answered_by, created_at, recording_key, from_phone, contact_id, contact:contacts(name, phone)',
      )
      .eq('account_id', accountId)
      .gte('created_at', since.toISOString())
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS + 1)

    if (error) {
      return NextResponse.json({ error: 'Failed to load call analytics' }, { status: 500 })
    }

    const all = (data ?? []) as AnalyticsCallRow[]
    const truncated = all.length > MAX_ROWS
    const rows = truncated ? all.slice(0, MAX_ROWS) : all

    const agentIds = [
      ...new Set(rows.map((r) => r.answered_by).filter((id): id is string => Boolean(id))),
    ]
    const names = new Map<string, string>()
    if (agentIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email')
        .in('user_id', agentIds)
      for (const profile of profiles ?? []) {
        names.set(
          profile.user_id as string,
          (profile.full_name as string | null)?.trim() ||
            (profile.email as string | null) ||
            profile.user_id,
        )
      }
    }

    const { data: wa } = await supabase
      .from('whatsapp_config')
      .select('calling_status')
      .eq('account_id', accountId)
      .maybeSingle()

    return NextResponse.json({
      window_days: days,
      truncated,
      calling_status: wa?.calling_status === 'enabled' ? 'enabled' : 'disabled',
      ...aggregateCallAnalytics(rows, days, names),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
