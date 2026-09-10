import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MissingAccountIdError } from './contracts'
import {
  attributeUsage,
  evaluateAccountPatternEffectiveness,
  rollupEffectiveness,
  type SalesPatternUsageRow,
  type TerminalSalesEventRow,
} from './evaluate-pattern-effectiveness'
import {
  MIN_EFFECTIVENESS_ELIGIBLE,
  nextRetrievalEligible,
  observedSuccessRate,
} from './pattern-effectiveness-types'

const unusedDb = {} as SupabaseClient

function usage(
  partial: Partial<SalesPatternUsageRow> & Pick<SalesPatternUsageRow, 'id' | 'pattern_id'>
): SalesPatternUsageRow {
  return {
    account_id: 'acct-a',
    conversation_id: 'conv-1',
    used_at: '2026-09-01T00:00:00.000Z',
    attribution_status: 'unresolved',
    attributed_event_id: null,
    attributed_event_type: null,
    ...partial,
  }
}

function event(
  partial: Partial<TerminalSalesEventRow> & Pick<TerminalSalesEventRow, 'id' | 'event_type'>
): TerminalSalesEventRow {
  return {
    account_id: 'acct-a',
    conversation_id: 'conv-1',
    kind: 'outcome',
    created_at: '2026-09-01T12:00:00.000Z',
    ...partial,
  }
}

describe('attributeUsage', () => {
  const injected = usage({ id: 'u-1', pattern_id: 'p-1' })

  it('associates the latest terminal outcome after injection within 7 days', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-abandon',
        event_type: 'CHECKOUT_ABANDONED',
        created_at: '2026-09-01T06:00:00.000Z',
      }),
      event({
        id: 'e-order',
        event_type: 'ORDER_CREATED',
        created_at: '2026-09-02T00:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('success')
    expect(result.attributed_event_id).toBe('e-order')
  })

  it('treats cancellation after payment as failure when cancel is later', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-paid',
        event_type: 'PAYMENT_COMPLETED',
        created_at: '2026-09-01T06:00:00.000Z',
      }),
      event({
        id: 'e-cancel',
        event_type: 'ORDER_CANCELLED',
        created_at: '2026-09-02T00:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('failure')
    expect(result.attributed_event_id).toBe('e-cancel')
  })

  it('ignores outcomes before injection', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-early',
        event_type: 'ORDER_CREATED',
        created_at: '2026-08-31T00:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('unresolved')
  })

  it('ignores outcomes outside the 7-day window', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-late',
        event_type: 'ORDER_CREATED',
        created_at: '2026-09-10T00:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('unresolved')
  })

  it('does not treat mid-funnel or purchase intent as success or failure', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-cart',
        event_type: 'CART_CREATED',
        created_at: '2026-09-01T12:00:00.000Z',
      }),
      event({
        id: 'e-intent',
        event_type: 'PURCHASE_INTENT',
        kind: 'signal',
        created_at: '2026-09-01T12:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('unresolved')
  })

  it('does not attribute another tenant’s outcome', () => {
    const result = attributeUsage(injected, [
      event({
        id: 'e-b',
        event_type: 'ORDER_CREATED',
        account_id: 'acct-b',
      }),
    ])
    expect(result.attribution_status).toBe('unresolved')
  })
})

describe('rollupEffectiveness', () => {
  it('excludes unresolved from the observed success rate', () => {
    const rolled = rollupEffectiveness([
      {
        ...usage({ id: 'u-1', pattern_id: 'p-1' }),
        attribution_status: 'success',
        attributed_event_id: 'e-1',
        attributed_event_type: 'ORDER_CREATED',
      },
      {
        ...usage({ id: 'u-2', pattern_id: 'p-1', conversation_id: 'conv-2' }),
        attribution_status: 'failure',
        attributed_event_id: 'e-2',
        attributed_event_type: 'CHECKOUT_ABANDONED',
      },
      {
        ...usage({ id: 'u-3', pattern_id: 'p-1', conversation_id: 'conv-3' }),
        attribution_status: 'unresolved',
        attributed_event_id: null,
        attributed_event_type: null,
      },
    ])
    const metrics = rolled.get('p-1')
    expect(metrics).toMatchObject({
      usageCount: 3,
      eligibleUsageCount: 2,
      successCount: 1,
      failureCount: 1,
      unresolvedCount: 1,
      observedSuccessRate: 0.5,
    })
    expect(observedSuccessRate(1, 1)).toBe(0.5)
  })
})

describe('nextRetrievalEligible', () => {
  it('does not demote with fewer than 5 eligible usages', () => {
    expect(
      nextRetrievalEligible({
        eligibleUsageCount: MIN_EFFECTIVENESS_ELIGIBLE - 1,
        observedSuccessRate: 0,
        currentEligible: true,
      })
    ).toBe(true)
  })

  it('demotes when eligible evidence is poor and restores when it recovers', () => {
    expect(
      nextRetrievalEligible({
        eligibleUsageCount: 5,
        observedSuccessRate: 0.2,
        currentEligible: true,
      })
    ).toBe(false)
    expect(
      nextRetrievalEligible({
        eligibleUsageCount: 5,
        observedSuccessRate: 0.25,
        currentEligible: false,
      })
    ).toBe(true)
  })
})

describe('evaluateAccountPatternEffectiveness', () => {
  it('throws before loaders when accountId is missing', async () => {
    const loadUsages = vi.fn()
    await expect(
      evaluateAccountPatternEffectiveness(unusedDb, '', { loadUsages })
    ).rejects.toBeInstanceOf(MissingAccountIdError)
    expect(loadUsages).not.toHaveBeenCalled()
  })

  it('filters poisoned usages from another account', async () => {
    const writeAttributions = vi.fn()
    const writeEffectiveness = vi.fn()
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', {
      loadMode: async () => 'on',
      loadUsages: async () => [
        usage({ id: 'u-b', pattern_id: 'p-b', account_id: 'acct-b' }),
      ],
      loadTerminalEvents: async () => [],
      loadEligibility: async () => [],
      writeAttributions,
      writeEffectiveness,
      upsertCursor: async () => undefined,
    })
    expect(writeAttributions).not.toHaveBeenCalled()
    expect(writeEffectiveness).not.toHaveBeenCalled()
  })

  it('writes the same metrics on a second run', async () => {
    const usages = [
      usage({ id: 'u-1', pattern_id: 'p-1' }),
      usage({ id: 'u-2', pattern_id: 'p-1', conversation_id: 'conv-2' }),
    ]
    const events = [
      event({
        id: 'e-1',
        event_type: 'ORDER_CREATED',
        conversation_id: 'conv-1',
      }),
      event({
        id: 'e-2',
        event_type: 'CHECKOUT_ABANDONED',
        conversation_id: 'conv-2',
      }),
    ]
    const deps = {
      loadMode: async () => 'on' as const,
      loadUsages: async () => usages,
      loadTerminalEvents: async () => events,
      loadEligibility: async () => [
        { id: 'p-1', account_id: 'acct-a', retrieval_eligible: true },
      ],
      writeAttributions: vi.fn(),
      writeEffectiveness: vi.fn(),
      upsertCursor: async () => undefined,
    }
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', deps)
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', deps)
    const first = deps.writeEffectiveness.mock.calls[0][2]
    const second = deps.writeEffectiveness.mock.calls[1][2]
    expect(first).toEqual(second)
    expect(first[0].effectiveness.observedSuccessRate).toBe(0.5)
  })

  it('does not flip retrieval_eligible when the flag is off or shadow', async () => {
    const writeEffectiveness = vi.fn()
    const log = vi.fn()
    const usages = Array.from({ length: 5 }, (_, i) =>
      usage({
        id: `u-${i}`,
        pattern_id: 'p-1',
        conversation_id: `conv-${i}`,
      })
    )
    const events = usages.map((row, i) =>
      event({
        id: `e-${i}`,
        event_type: 'CHECKOUT_ABANDONED',
        conversation_id: row.conversation_id,
      })
    )
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', {
      loadMode: async () => 'shadow',
      loadUsages: async () => usages,
      loadTerminalEvents: async () => events,
      loadEligibility: async () => [
        { id: 'p-1', account_id: 'acct-a', retrieval_eligible: true },
      ],
      writeAttributions: vi.fn(),
      writeEffectiveness,
      upsertCursor: async () => undefined,
      log,
    })
    expect(writeEffectiveness.mock.calls[0][2][0].writeEligibility).toBe(false)
    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls[0][0])).not.toMatch(
      /phone|email|transcript|looks good/i
    )
  })

  it('writes retrieval_eligible=false when on and evidence is poor', async () => {
    const writeEffectiveness = vi.fn()
    const usages = Array.from({ length: 5 }, (_, i) =>
      usage({
        id: `u-${i}`,
        pattern_id: 'p-1',
        conversation_id: `conv-${i}`,
      })
    )
    const events = usages.map((row, i) =>
      event({
        id: `e-${i}`,
        event_type: 'CHECKOUT_ABANDONED',
        conversation_id: row.conversation_id,
      })
    )
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', {
      loadMode: async () => 'on',
      loadUsages: async () => usages,
      loadTerminalEvents: async () => events,
      loadEligibility: async () => [
        { id: 'p-1', account_id: 'acct-a', retrieval_eligible: true },
      ],
      writeAttributions: vi.fn(),
      writeEffectiveness,
      upsertCursor: async () => undefined,
    })
    const update = writeEffectiveness.mock.calls[0][2][0]
    expect(update.writeEligibility).toBe(true)
    expect(update.retrievalEligible).toBe(false)
    expect(update.effectiveness.eligibleUsageCount).toBe(5)
    expect(update.effectiveness.observedSuccessRate).toBe(0)
  })

  it('associates every injected pattern in a conversation with the same outcome', async () => {
    const writeAttributions = vi.fn()
    await evaluateAccountPatternEffectiveness(unusedDb, 'acct-a', {
      loadMode: async () => 'off',
      loadUsages: async () => [
        usage({ id: 'u-1', pattern_id: 'p-1' }),
        usage({ id: 'u-2', pattern_id: 'p-2' }),
      ],
      loadTerminalEvents: async () => [
        event({ id: 'e-1', event_type: 'PAYMENT_COMPLETED' }),
      ],
      loadEligibility: async () => [
        { id: 'p-1', account_id: 'acct-a', retrieval_eligible: true },
        { id: 'p-2', account_id: 'acct-a', retrieval_eligible: true },
      ],
      writeAttributions,
      writeEffectiveness: vi.fn(),
      upsertCursor: async () => undefined,
    })
    const statuses = writeAttributions.mock.calls[0][2] as Array<{
      attribution_status: string
    }>
    expect(statuses.every((row) => row.attribution_status === 'success')).toBe(
      true
    )
  })
})
