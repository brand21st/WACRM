import { lastNDayKeys, localDayKey } from '@/lib/dashboard/date-utils'
import { formatCallDuration } from '@/lib/calls/preview'
import type { CallStatus } from '@/types'

export type AnalyticsCallRow = {
  id: string
  status: CallStatus
  duration_seconds: number | null
  answered_by: string | null
  created_at: string
  recording_key: string | null
  from_phone: string | null
  contact_id: string | null
  contacts?: { name?: string | null; phone?: string | null } | null
  contact?: { name?: string | null; phone?: string | null } | null
}

export type AgentStat = {
  userId: string | null
  name: string
  answered: number
  durationSeconds: number
}

export function aggregateCallAnalytics(
  rows: AnalyticsCallRow[],
  days: number,
  agentNames: Map<string, string>,
) {
  const dailyKeys = lastNDayKeys(days)
  const dailyMap = new Map(dailyKeys.map((key) => [key, 0]))
  const byAgent = new Map<string, AgentStat>()

  let answered = 0
  let missed = 0
  let rejected = 0
  let failed = 0
  let durationSum = 0
  let durationCount = 0

  for (const row of rows) {
    const key = localDayKey(row.created_at)
    if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) ?? 0) + 1)

    if (row.status === 'completed' || row.status === 'in_progress') answered += 1
    else if (row.status === 'missed') missed += 1
    else if (row.status === 'rejected') rejected += 1
    else if (row.status === 'failed') failed += 1

    if (typeof row.duration_seconds === 'number' && row.duration_seconds >= 0) {
      durationSum += row.duration_seconds
      durationCount += 1
    }

    if (row.answered_by) {
      const current = byAgent.get(row.answered_by) ?? {
        userId: row.answered_by,
        name: agentNames.get(row.answered_by) ?? row.answered_by,
        answered: 0,
        durationSeconds: 0,
      }
      current.answered += 1
      current.durationSeconds += row.duration_seconds ?? 0
      byAgent.set(row.answered_by, current)
    }
  }

  return {
    totals: {
      volume: rows.length,
      answered,
      missed,
      rejected,
      failed,
      avgDurationSeconds: durationCount ? Math.round(durationSum / durationCount) : 0,
      totalDurationSeconds: durationSum,
    },
    daily: dailyKeys.map((date) => ({ date, calls: dailyMap.get(date) ?? 0 })),
    byAgent: [...byAgent.values()].sort((a, b) => b.answered - a.answered),
    recent: rows.slice(0, 20).map((row) => ({
      id: row.id,
      status: row.status,
      duration: formatCallDuration(row.duration_seconds ?? 0),
      recorded: Boolean(row.recording_key),
      createdAt: row.created_at,
      contact:
        row.contact?.name?.trim() ||
        row.contact?.phone ||
        row.contacts?.name?.trim() ||
        row.contacts?.phone ||
        row.from_phone ||
        null,
      agent: row.answered_by
        ? (agentNames.get(row.answered_by) ?? row.answered_by)
        : null,
    })),
  }
}
