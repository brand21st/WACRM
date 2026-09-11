import { describe, expect, it, vi } from 'vitest'
import {
  getAccountExperimentDetail,
  getAccountSalesPattern,
  listAccountSalesPatterns,
} from './ai-intelligence-admin'

function missingRelation(relation: string) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({
            data: null,
            error: { code: '42P01', message: `relation ${relation} does not exist` },
          }),
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: '42P01', message: `relation ${relation} does not exist` },
            }),
          }),
          maybeSingle: async () => ({
            data: null,
            error: { code: '42P01', message: `relation ${relation} does not exist` },
          }),
        }),
      }),
    }),
  }
}

describe('ai-intelligence-admin missing schema', () => {
  it('lists patterns as unavailable without throwing', async () => {
    const result = await listAccountSalesPatterns(
      missingRelation('sales_patterns') as never,
      'acct-1',
    )
    expect(result).toEqual({ available: false, patterns: [] })
  })

  it('returns unavailable for a missing pattern table', async () => {
    const result = await getAccountSalesPattern(
      missingRelation('sales_patterns') as never,
      'acct-1',
      'pat-1',
    )
    expect(result).toEqual({ available: false, pattern: null })
  })

  it('returns null for a missing experiment (other-account or missing table)', async () => {
    const result = await getAccountExperimentDetail(
      missingRelation('ai_behavior_experiments') as never,
      'acct-1',
      'exp-other',
    )
    expect(result).toBeNull()
  })
})

describe('ai-intelligence-admin account scope', () => {
  it('filters pattern list by account_id', async () => {
    const eq = vi.fn()
    const order = vi.fn().mockResolvedValue({ data: [], error: null })
    eq.mockReturnValue({ order })
    const db = {
      from: () => ({
        select: () => ({ eq }),
      }),
    }
    await listAccountSalesPatterns(db as never, 'acct-1')
    expect(eq).toHaveBeenCalledWith('account_id', 'acct-1')
  })
})
