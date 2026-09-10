import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MissingAccountIdError } from './contracts'
import {
  discoverAccountPatterns,
  drainPatternDiscoveryJobs,
  toSalesPatternContract,
} from './discover-patterns'
import type { AggregateSalesEvent } from './aggregate-sales-events'

const db = {} as SupabaseClient

function events(count: number, accountId = 'acct-a'): AggregateSalesEvent[] {
  const rows: AggregateSalesEvent[] = []
  for (let i = 0; i < count; i += 1) {
    rows.push({
      account_id: accountId,
      conversation_id: `conv-${i}`,
      event_type: 'PRICE_OBJECTION',
      kind: 'signal',
      metadata: {},
      created_at: `2026-08-0${(i % 9) + 1}T00:00:00.000Z`,
    })
  }
  return rows
}

describe('discoverAccountPatterns isolation', () => {
  it('throws before any loader when accountId is missing', async () => {
    const loadEvents = vi.fn()
    await expect(
      discoverAccountPatterns(db, '', { loadEvents }),
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(loadEvents).not.toHaveBeenCalled()
  })

  it('drops poisoned events from another account', async () => {
    const upsertPatterns = vi.fn().mockResolvedValue(1)
    const upsertCursor = vi.fn()
    await discoverAccountPatterns(db, 'acct-a', {
      loadEvents: async () => [
        ...events(3, 'acct-a'),
        {
          account_id: 'acct-b',
          conversation_id: 'conv-b',
          event_type: 'PRICE_OBJECTION',
          kind: 'signal',
          metadata: {},
          created_at: '2026-08-01T00:00:00.000Z',
        },
      ],
      loadCatalogPrices: async () => new Map(),
      loadExistingPatterns: async () => [],
      upsertPatterns,
      markMissingPatterns: async () => 0,
      upsertCursor,
    })
    const aggregated = upsertPatterns.mock.calls[0][1] as Array<{
      sampleCount: number
      accountId: string
    }>
    expect(aggregated).toHaveLength(1)
    expect(aggregated[0].accountId).toBe('acct-a')
    expect(aggregated[0].sampleCount).toBe(3)
  })

  it('does not write when the account has no events', async () => {
    const upsertPatterns = vi.fn()
    const result = await discoverAccountPatterns(db, 'acct-a', {
      loadEvents: async () => [],
      upsertPatterns,
      upsertCursor: async () => undefined,
    })
    expect(result.skipped).toBe(true)
    expect(upsertPatterns).not.toHaveBeenCalled()
  })

  it('recomputes the same pattern key on a second run', async () => {
    const existingKey = 'acct-a|PRICE_OBJECTION|PRICE_OBJECTION|||'
    const upsertPatterns = vi.fn().mockResolvedValue(1)
    await discoverAccountPatterns(db, 'acct-a', {
      loadEvents: async () => events(4),
      loadCatalogPrices: async () => new Map(),
      loadExistingPatterns: async () => [
        {
          pattern_key: existingKey,
          created_at: '2026-01-01T00:00:00.000Z',
          last_observed_at: '2026-08-01T00:00:00.000Z',
          status: 'candidate',
        },
      ],
      upsertPatterns,
      markMissingPatterns: async () => 0,
      upsertCursor: async () => undefined,
    })
    const aggregated = upsertPatterns.mock.calls[0][1] as Array<{ patternKey: string }>
    expect(aggregated[0].patternKey).toBe(existingKey)
  })
})

describe('drainPatternDiscoveryJobs', () => {
  it('runs inline when enqueue returns false', async () => {
    const discover = vi.fn().mockResolvedValue({
      accountId: 'acct-a',
      wrote: 1,
      staleUpdated: 0,
      skipped: false,
    })
    const result = await drainPatternDiscoveryJobs(db, {
      listDue: async () => ['acct-a'],
      enqueue: async () => false,
      discover,
    })
    expect(result).toEqual({ queued: 0, ran: 1, accounts: ['acct-a'] })
    expect(discover).toHaveBeenCalledWith(db, 'acct-a')
  })

  it('counts a queued job and does not inline', async () => {
    const discover = vi.fn()
    const result = await drainPatternDiscoveryJobs(db, {
      listDue: async () => ['acct-a'],
      enqueue: async () => true,
      discover,
    })
    expect(result).toEqual({ queued: 1, ran: 0, accounts: ['acct-a'] })
    expect(discover).not.toHaveBeenCalled()
  })
})

describe('toSalesPatternContract', () => {
  it('maps active from status and never omits accountId', () => {
    const view = toSalesPatternContract({
      accountId: 'acct-a',
      patternKey: 'k',
      patternType: 'PRICE_OBJECTION',
      triggerEventType: 'PRICE_OBJECTION',
      context: { category: 'kurti' },
      recommendedBehavior: 'OFFER_RELEVANT_ALTERNATIVE',
      evidence: {
        signalCount: 8,
        outcomeCount: 5,
        successRate: 0.6,
        firstObservedAt: null,
        lastObservedAt: null,
      },
      confidence: 0.5,
      sampleCount: 8,
      successCount: 3,
      failureCount: 2,
      eligibleOutcomeCount: 5,
      unresolvedCount: 3,
      status: 'active',
      firstObservedAt: null,
      lastObservedAt: null,
    })
    expect(view.accountId).toBe('acct-a')
    expect(view.active).toBe(true)
    expect(view.evidenceCount).toBe(8)
    expect(view.outcomeMetrics.eligible).toBe(5)
  })
})
