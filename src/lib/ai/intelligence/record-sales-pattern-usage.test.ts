import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MissingAccountIdError } from './contracts'
import { recordSalesPatternUsage } from './record-sales-pattern-usage'
import type { RetrievedSalesPattern } from './retrieve-sales-patterns'

const unusedDb = {} as SupabaseClient

function match(id: string): RetrievedSalesPattern {
  return {
    patternId: id,
    patternType: 'PRICE_OBJECTION',
    triggerEventType: 'PRICE_OBJECTION',
    context: {},
    recommendedBehavior: 'OFFER_RELEVANT_ALTERNATIVE',
    confidence: 0.5,
    sampleCount: 8,
    eligibleOutcomeCount: 5,
    successRate: null,
    matchScore: 40,
    matchReasons: ['patternType'],
  }
}

describe('recordSalesPatternUsage', () => {
  it('throws before upsert when accountId is missing', async () => {
    const upsertUsages = vi.fn()
    const written = await recordSalesPatternUsage(
      unusedDb,
      {
        accountId: '',
        conversationId: 'conv-1',
        matches: [match('p-1')],
      },
      { upsertUsages }
    )
    expect(written).toBe(0)
    expect(upsertUsages).not.toHaveBeenCalled()
  })

  it('writes one row per injected pattern and ignores duplicates in the same call', async () => {
    const upsertUsages = vi.fn().mockResolvedValue(2)
    const written = await recordSalesPatternUsage(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        matches: [match('p-1'), match('p-2'), match('p-1')],
        usedAt: '2026-09-01T00:00:00.000Z',
      },
      { upsertUsages }
    )
    expect(written).toBe(2)
    expect(upsertUsages).toHaveBeenCalledTimes(1)
    const rows = upsertUsages.mock.calls[0][1]
    expect(rows).toHaveLength(2)
    expect(rows.map((row: { pattern_id: string }) => row.pattern_id)).toEqual([
      'p-1',
      'p-2',
    ])
    expect(rows[0]).toMatchObject({
      account_id: 'acct-a',
      conversation_id: 'conv-1',
      used_at: '2026-09-01T00:00:00.000Z',
      attribution_status: 'unresolved',
    })
    expect(JSON.stringify(rows)).not.toMatch(/phone|email|transcript|too expensive/i)
  })

  it('does not write when there are no matches', async () => {
    const upsertUsages = vi.fn()
    expect(
      await recordSalesPatternUsage(
        unusedDb,
        { accountId: 'acct-a', conversationId: 'conv-1', matches: [] },
        { upsertUsages }
      )
    ).toBe(0)
    expect(upsertUsages).not.toHaveBeenCalled()
  })

  it('swallows upsert failures so the reply can continue', async () => {
    const written = await recordSalesPatternUsage(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        matches: [match('p-1')],
      },
      {
        upsertUsages: async () => {
          throw new Error('db down')
        },
      }
    )
    expect(written).toBe(0)
  })
})

describe('recordSalesPatternUsage isolation', () => {
  it('requireAccountId rejects blank ids', () => {
    expect(() => {
      throw new MissingAccountIdError('recordSalesPatternUsage')
    }).toThrow(MissingAccountIdError)
  })
})
