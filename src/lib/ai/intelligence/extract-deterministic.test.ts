import { describe, expect, it } from 'vitest'
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context'
import {
  extractDeterministicEvents,
  shouldSkipLlm,
  type AnalyzerMessage,
  type DeterministicExtractInput,
} from './extract-deterministic'

const BASE: DeterministicExtractInput = {
  accountId: 'acct-a',
  conversationId: 'conv-a',
  contactId: 'contact-a',
  newMessages: [],
  commerceOrders: [],
  catalogEvents: [],
  abandonedCheckouts: [],
  shopping: emptyShoppingContext(),
  existingEvents: [],
}

function customer(partial: Partial<AnalyzerMessage> & { id: string; content_text?: string | null }): AnalyzerMessage {
  return {
    sender_type: 'customer',
    content_type: 'text',
    interactive_reply_id: null,
    interactive_payload: null,
    created_at: '2026-01-01T00:00:00.000Z',
    content_text: partial.content_text ?? null,
    ...partial,
  }
}

describe('extractDeterministicEvents', () => {
  it('emits CART_CREATED from an inbound order message', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      newMessages: [
        customer({
          id: 'msg-order',
          content_type: 'order',
          content_text: 'Red bag × 1',
          interactive_payload: {
            kind: 'inbound_order',
            items: [{ product_retailer_id: 'BAG-RED' }],
          },
        }),
      ],
    })
    expect(events.map((e) => e.eventType)).toContain('CART_CREATED')
    expect(events.find((e) => e.eventType === 'CART_CREATED')?.kind).toBe('outcome')
    expect(events.find((e) => e.eventType === 'CART_CREATED')?.metadata.productId).toBe(
      'BAG-RED',
    )
  })

  it('emits CHECKOUT_STARTED from a pending commerce order', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      commerceOrders: [{ id: 'ord-1', status: 'pending', line_items: [] }],
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'CHECKOUT_STARTED',
          kind: 'outcome',
          sourceId: 'ord-1:pending',
        }),
      ]),
    )
    expect(events.some((e) => e.eventType === 'ORDER_CREATED')).toBe(false)
  })

  it('emits ORDER_CREATED and PAYMENT_COMPLETED from a paid commerce order', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      commerceOrders: [
        {
          id: 'ord-paid',
          status: 'processing',
          line_items: [{ product_id: 'prod-1' }],
        },
      ],
    })
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'ORDER_CREATED',
      'PAYMENT_COMPLETED',
    ])
    expect(events.every((e) => e.kind === 'outcome')).toBe(true)
  })

  it('emits PAYMENT_COMPLETED from a catalog purchase event', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      catalogEvents: [
        { id: 'cpe-1', event: 'purchase', product_id: 'prod-9' },
      ],
    })
    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'PAYMENT_COMPLETED',
        kind: 'outcome',
        sourceTable: 'catalog_product_events',
        sourceId: 'cpe-1',
        metadata: { productId: 'prod-9' },
      }),
    ])
  })

  it('maps classifySalesTurn purchase to signals, never ORDER_CREATED', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      newMessages: [customer({ id: 'msg-buy', content_text: "I'll take this" })],
    })
    expect(events.map((e) => e.eventType).sort()).toEqual([
      'PURCHASE_INTENT',
      'READY_TO_BUY',
    ])
    expect(events.every((e) => e.kind === 'signal')).toBe(true)
    expect(events.some((e) => e.eventType === 'ORDER_CREATED')).toBe(false)
  })

  it('maps a price objection and a comparison', () => {
    const expensive = extractDeterministicEvents({
      ...BASE,
      newMessages: [customer({ id: 'msg-exp', content_text: 'too expensive' })],
    })
    expect(expensive.map((e) => e.eventType)).toEqual(['PRICE_OBJECTION'])

    const compare = extractDeterministicEvents({
      ...BASE,
      newMessages: [
        customer({ id: 'msg-cmp', content_text: 'which one is better' }),
      ],
    })
    expect(compare.map((e) => e.eventType)).toEqual(['PRODUCT_COMPARISON'])
  })

  it('does not treat looks good as a sale', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      newMessages: [customer({ id: 'msg-nice', content_text: 'looks good' })],
    })
    expect(events.some((e) => e.eventType === 'ORDER_CREATED')).toBe(false)
    expect(events.some((e) => e.eventType === 'PAYMENT_COMPLETED')).toBe(false)
    expect(events.some((e) => e.eventType === 'PURCHASE_INTENT')).toBe(false)
  })

  it('skips shopping-context ids that are already stored', () => {
    const events = extractDeterministicEvents({
      ...BASE,
      shopping: {
        ...emptyShoppingContext(),
        selectedIds: ['prod-a'],
        rejectedIds: ['prod-b'],
      },
      existingEvents: [
        { event_type: 'PRODUCT_SELECTED', metadata: { productId: 'prod-a' } },
      ],
    })
    expect(events.map((e) => e.eventType)).toEqual(['PRODUCT_OBJECTION'])
    expect(events[0].metadata.productId).toBe('prod-b')
  })
})

describe('shouldSkipLlm', () => {
  it('skips greetings, looks-good, and wacrm button taps', () => {
    expect(
      shouldSkipLlm({
        newMessages: [customer({ id: '1', content_text: 'ok' })],
        deterministic: [],
      }),
    ).toBe(true)
    expect(
      shouldSkipLlm({
        newMessages: [customer({ id: '2', content_text: 'looks good' })],
        deterministic: [],
      }),
    ).toBe(true)
    expect(
      shouldSkipLlm({
        newMessages: [
          customer({
            id: '3',
            content_text: 'New products',
            interactive_reply_id: 'wacrm:products',
          }),
        ],
        deterministic: [],
      }),
    ).toBe(true)
  })

  it('skips when a deterministic outcome already exists for the turn', () => {
    expect(
      shouldSkipLlm({
        newMessages: [customer({ id: '4', content_text: 'why is shipping slow' })],
        deterministic: [
          {
            eventType: 'CART_CREATED',
            kind: 'outcome',
            confidence: 0.95,
            metadata: {},
            sourceMessageId: '4',
            sourceTable: 'messages',
            sourceId: '4',
          },
        ],
      }),
    ).toBe(true)
  })

  it('runs the LLM for a real customer question', () => {
    expect(
      shouldSkipLlm({
        newMessages: [
          customer({ id: '5', content_text: 'can you ship this to Kochi tomorrow?' }),
        ],
        deterministic: [],
      }),
    ).toBe(false)
  })
})
