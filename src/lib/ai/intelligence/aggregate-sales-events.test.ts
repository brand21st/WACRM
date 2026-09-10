import { describe, expect, it } from 'vitest'
import {
  aggregateSalesEvents,
  conversationOutcomeFromEvents,
  patternConfidence,
  patternLifecycleStatus,
  type AggregateSalesEvent,
} from './aggregate-sales-events'

const NOW = new Date('2026-09-10T00:00:00.000Z')

function event(
  partial: Partial<AggregateSalesEvent> &
    Pick<AggregateSalesEvent, 'conversation_id' | 'event_type'>,
): AggregateSalesEvent {
  return {
    account_id: 'acct-a',
    kind: partial.kind ?? 'signal',
    metadata: partial.metadata ?? {},
    created_at: partial.created_at ?? '2026-08-01T00:00:00.000Z',
    ...partial,
  }
}

function conversations(
  type: string,
  count: number,
  outcome: 'success' | 'failure' | 'none' = 'none',
  extras: Partial<AggregateSalesEvent> = {},
): AggregateSalesEvent[] {
  const rows: AggregateSalesEvent[] = []
  for (let i = 0; i < count; i += 1) {
    const conversationId = extras.conversation_id
      ? `${extras.conversation_id}-${i}`
      : `conv-${type}-${i}`
    rows.push(
      event({
        conversation_id: conversationId,
        event_type: type,
        kind: 'signal',
        metadata: extras.metadata,
        created_at: extras.created_at,
      }),
    )
    if (outcome === 'success') {
      rows.push(
        event({
          conversation_id: conversationId,
          event_type: 'PAYMENT_COMPLETED',
          kind: 'outcome',
        }),
      )
    }
    if (outcome === 'failure') {
      rows.push(
        event({
          conversation_id: conversationId,
          event_type: 'CHECKOUT_ABANDONED',
          kind: 'outcome',
        }),
      )
    }
  }
  return rows
}

describe('conversationOutcomeFromEvents', () => {
  it('treats ORDER_CREATED and PAYMENT_COMPLETED as success', () => {
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'ORDER_CREATED', kind: 'outcome' }),
      ]),
    ).toBe('success')
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'PAYMENT_COMPLETED', kind: 'outcome' }),
      ]),
    ).toBe('success')
  })

  it('treats cancel/abandon as failure only without a success', () => {
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'ORDER_CANCELLED', kind: 'outcome' }),
      ]),
    ).toBe('failure')
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'CHECKOUT_ABANDONED', kind: 'outcome' }),
        event({ conversation_id: 'c1', event_type: 'PAYMENT_COMPLETED', kind: 'outcome' }),
      ]),
    ).toBe('success')
  })

  it('does not treat looks-good signals or mid-funnel as a sale', () => {
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'INTERESTED', kind: 'signal' }),
      ]),
    ).toBe('unresolved')
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'PURCHASE_INTENT', kind: 'signal' }),
      ]),
    ).toBe('unresolved')
    expect(
      conversationOutcomeFromEvents([
        event({ conversation_id: 'c1', event_type: 'CART_CREATED', kind: 'outcome' }),
      ]),
    ).toBe('unresolved')
  })
})

describe('aggregateSalesEvents', () => {
  it('drops events from another account before grouping', () => {
    const patterns = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: [
        ...conversations('PRICE_OBJECTION', 3),
        event({
          account_id: 'acct-b',
          conversation_id: 'conv-b',
          event_type: 'PRICE_OBJECTION',
          kind: 'signal',
        }),
      ],
    })
    expect(patterns).toHaveLength(1)
    expect(patterns[0].sampleCount).toBe(3)
    expect(patterns[0].accountId).toBe('acct-a')
  })

  it('merges many conversations into one pattern and updates the same key', () => {
    const first = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRICE_OBJECTION', 3),
    })
    const second = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRICE_OBJECTION', 5),
    })
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0].patternKey).toBe(second[0].patternKey)
    expect(second[0].sampleCount).toBe(5)
  })

  it('counts verified outcomes and excludes unresolved from successRate', () => {
    const patterns = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: [
        ...conversations('PRICE_OBJECTION', 20, 'success'),
        ...conversations('PRICE_OBJECTION', 10, 'failure', {
          conversation_id: 'fail',
        }),
        ...conversations('PRICE_OBJECTION', 70, 'none', {
          conversation_id: 'open',
        }),
      ],
    })
    expect(patterns[0].sampleCount).toBe(100)
    expect(patterns[0].successCount).toBe(20)
    expect(patterns[0].failureCount).toBe(10)
    expect(patterns[0].eligibleOutcomeCount).toBe(30)
    expect(patterns[0].unresolvedCount).toBe(70)
    expect(patterns[0].evidence.successRate).toBeCloseTo(20 / 30)
    expect(patterns[0].status).toBe('active')
  })

  it('keeps PURCHASE_INTENT without commerce as unresolved', () => {
    const patterns = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PURCHASE_INTENT', 3),
    })
    expect(patterns[0].successCount).toBe(0)
    expect(patterns[0].unresolvedCount).toBe(3)
    expect(patterns[0].evidence.successRate).toBeNull()
    expect(patterns[0].status).toBe('candidate')
  })

  it('does not create a pattern below the candidate threshold', () => {
    expect(
      aggregateSalesEvents({
        accountId: 'acct-a',
        now: NOW,
        events: conversations('PRICE_OBJECTION', 2),
      }),
    ).toEqual([])
  })

  it('becomes active only with enough samples and eligible outcomes', () => {
    const candidate = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRODUCT_COMPARISON', 3, 'success'),
    })
    expect(candidate[0].status).toBe('candidate')

    const active = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRODUCT_COMPARISON', 8, 'success'),
    })
    expect(active[0].status).toBe('active')
    expect(active[0].eligibleOutcomeCount).toBe(8)
  })

  it('marks stale and archived from lastObservedAt', () => {
    expect(
      patternLifecycleStatus({
        sampleCount: 8,
        eligibleOutcomeCount: 5,
        lastObservedAt: '2026-05-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toBe('stale')
    expect(
      patternLifecycleStatus({
        sampleCount: 8,
        eligibleOutcomeCount: 5,
        lastObservedAt: '2025-01-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toBe('archived')
  })

  it('keeps category and budget context; specializes productId only at threshold', () => {
    const general = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRICE_OBJECTION', 3, 'none', {
        metadata: { category: 'Kurti', budgetMax: 4000, productId: 'prod-1' },
      }),
    })
    expect(general[0].context).toEqual({
      category: 'kurti',
      priceBand: '3000-4999',
      budgetBand: '3000-4999',
    })
    expect(general[0].context.productId).toBeUndefined()

    const specialized = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: conversations('PRICE_OBJECTION', 8, 'none', {
        metadata: { productId: 'prod-1' },
      }),
    })
    expect(specialized[0].context.productId).toBe('prod-1')
  })

  it('uses a batched catalog price when metadata has no budget', () => {
    const patterns = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      catalogPrices: new Map([['prod-9', 2500]]),
      events: conversations('PRODUCT_INQUIRY', 3, 'none', {
        metadata: { productId: 'prod-9' },
      }),
    })
    expect(patterns[0].context.priceBand).toBe('1000-2999')
    expect(patterns[0].recommendedBehavior).toBe('ANSWER_THEN_OFFER')
  })

  it('maps READY_TO_BUY onto PURCHASE_INTENT and ignores account B', () => {
    const patterns = aggregateSalesEvents({
      accountId: 'acct-a',
      now: NOW,
      events: [
        ...conversations('READY_TO_BUY', 3),
        event({
          account_id: 'acct-b',
          conversation_id: 'leak',
          event_type: 'PAYMENT_COMPLETED',
          kind: 'outcome',
        }),
      ],
    })
    expect(patterns[0].patternType).toBe('PURCHASE_INTENT')
    expect(patterns[0].successCount).toBe(0)
  })
})

describe('patternConfidence', () => {
  it('shrinks toward zero with few eligible outcomes', () => {
    expect(patternConfidence(0)).toBe(0)
    expect(patternConfidence(5)).toBe(0.5)
    expect(patternConfidence(15)).toBe(0.75)
  })
})
