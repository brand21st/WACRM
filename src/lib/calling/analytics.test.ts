import { describe, it, expect } from 'vitest'
import { aggregateCallAnalytics } from './analytics'

describe('aggregateCallAnalytics', () => {
  it('counts outcomes and buckets by local day', () => {
    const now = new Date()
    const rows = [
      {
        id: '1',
        status: 'completed' as const,
        duration_seconds: 60,
        answered_by: 'agent-a',
        created_at: now.toISOString(),
        recording_key: 'k',
        from_phone: '1555',
        contact_id: null,
        contacts: { name: 'Ada', phone: '1555' },
      },
      {
        id: '2',
        status: 'missed' as const,
        duration_seconds: null,
        answered_by: null,
        created_at: now.toISOString(),
        recording_key: null,
        from_phone: '1556',
        contact_id: null,
        contacts: null,
      },
    ]
    const out = aggregateCallAnalytics(rows, 7, new Map([['agent-a', 'Sam']]))
    expect(out.totals.volume).toBe(2)
    expect(out.totals.answered).toBe(1)
    expect(out.totals.missed).toBe(1)
    expect(out.totals.avgDurationSeconds).toBe(60)
    expect(out.byAgent[0]).toMatchObject({ name: 'Sam', answered: 1 })
    expect(out.daily.reduce((sum, d) => sum + d.calls, 0)).toBe(2)
  })
})
