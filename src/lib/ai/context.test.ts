import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  applySwipeReplyContext,
  buildConversationContext,
  formatSwipeReplyNote,
  loadQuotedParent,
  resolveInboundSwipeReply,
  SWIPE_REPLY_NOTE_PREFIX,
} from './context'
import { PHOTO_WAIT_ACK } from './photo-wait-ack'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().eq().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      { sender_type: 'customer', content_text: 'third' },
      { sender_type: 'agent', content_text: 'second' },
      { sender_type: 'customer', content_text: 'first' },
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'bot', content_text: 'auto reply' }]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('includes audio rows that have a transcript', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'bot', content_text: 'spoken reply', content_type: 'audio' },
        { sender_type: 'customer', content_text: 'hello from a voice note', content_type: 'audio' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'hello from a voice note' },
      { role: 'assistant', content: 'spoken reply' },
    ])
  })

  it('drops audio rows with no transcript', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: null, content_type: 'audio' },
        { sender_type: 'customer', content_text: 'typed', content_type: 'text' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'typed' }])
  })

  it('includes image rows that have a description', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: 'Here is the product photo',
          content_type: 'image',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: 'Here is the product photo' },
    ])
  })

  it('drops the photo wait-ack so the model does not echo it', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'bot', content_text: PHOTO_WAIT_ACK.en, content_type: 'text' },
        {
          sender_type: 'customer',
          content_text: 'pink gold saree',
          content_type: 'image',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'pink gold saree' }])
  })

  it('includes interactive product / cart bodies for the model', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: 'send cart link',
          content_type: 'text',
        },
        {
          sender_type: 'bot',
          content_text: 'Red Bag — 49 USD',
          content_type: 'interactive',
        },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'assistant', content: 'Red Bag — 49 USD' },
      { role: 'user', content: 'send cart link' },
    ])
  })

  it('drops other product cards from context when focus is set', async () => {
    const out = await buildConversationContext(
      fakeDb([
        {
          sender_type: 'customer',
          content_text: 'tell me more',
          content_type: 'text',
        },
        {
          sender_type: 'bot',
          content_text:
            'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
          content_type: 'image',
        },
        {
          sender_type: 'bot',
          content_text:
            'Silk Saree\n1499 INR\nStock in\nView: https://shop.example/products/silk-saree',
          content_type: 'image',
        },
      ]),
      'conv-1',
      undefined,
      { handle: 'pournami-red', title: 'Pournami' },
    )
    expect(out.map((m) => m.content)).toEqual([
      'Replying to product: Pournami (pournami-red)',
      'Pournami\n499 INR\nStock in\nView: https://shop.example/products/pournami-red',
      'tell me more',
    ])
  })

  it('prepends the selected product note when focus is set', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_text: 'tell me more' }]),
      'conv-1',
      undefined,
      { handle: 'pournami-red', title: 'Pournami' },
    )
    expect(out[0]).toEqual({
      role: 'assistant',
      content: 'Replying to product: Pournami (pournami-red)',
    })
    expect(out[1]).toEqual({ role: 'user', content: 'tell me more' })
  })

  it('drops empty / whitespace-only messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_text: '   ' },
        { sender_type: 'customer', content_text: null },
        { sender_type: 'customer', content_text: 'real' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  it('injects a swipe-reply parent as primary context even when it is not in last-N', async () => {
    const quoted = {
      id: 'parent-old',
      sender_type: 'bot' as const,
      content_type: 'interactive',
      content_text: 'Red Bag — 49 USD',
      interactive_payload: {
        kind: 'cta_url' as const,
        body: 'Red Bag — 49 USD',
        display_text: 'View',
        url: 'https://shop.example/products/red-bag',
      },
    }
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_text: 'what size?' }]),
      'conv-1',
      undefined,
      null,
      quoted,
    )
    expect(out[0]).toEqual({
      role: 'assistant',
      content: `${SWIPE_REPLY_NOTE_PREFIX}\nRed Bag — 49 USD`,
    })
    expect(out[1]).toEqual({
      role: 'user',
      content: '[Replying to: "Red Bag — 49 USD"]\nwhat size?',
    })
  })

  it('does not inject swipe-reply context when the parent body is empty', async () => {
    const out = await buildConversationContext(
      fakeDb([{ sender_type: 'customer', content_text: 'hello' }]),
      'conv-1',
      undefined,
      null,
      { id: 'empty', content_text: '   ' },
    )
    expect(out).toEqual([{ role: 'user', content: 'hello' }])
  })
})

describe('applySwipeReplyContext / formatSwipeReplyNote', () => {
  it('is a no-op without a parent', () => {
    const messages = [{ role: 'user' as const, content: 'hi' }]
    expect(applySwipeReplyContext(messages, null)).toEqual(messages)
    expect(formatSwipeReplyNote(null)).toBe('')
    expect(formatSwipeReplyNote({ id: 'x', content_text: '  ' })).toBe('')
  })

  it('prefers interactive payload body over content_text', () => {
    expect(
      formatSwipeReplyNote({
        id: 'p1',
        content_text: 'fallback',
        interactive_payload: {
          kind: 'buttons',
          body: 'Product card body',
          buttons: [{ id: 'a', title: 'A' }],
        },
      }),
    ).toBe(`${SWIPE_REPLY_NOTE_PREFIX}\nProduct card body`)
  })
})

describe('loadQuotedParent', () => {
  it('returns the parent row scoped to the conversation', async () => {
    const parent = {
      id: 'parent-1',
      sender_type: 'bot',
      content_type: 'text',
      content_text: 'Earlier offer',
      interactive_payload: null,
    }
    const db = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: parent, error: null }),
        }
        return chain
      },
    } as unknown as SupabaseClient
    await expect(loadQuotedParent(db, 'conv-1', 'parent-1')).resolves.toEqual(parent)
  })

  it('returns null when the parent is missing', async () => {
    const db = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }
        return chain
      },
    } as unknown as SupabaseClient
    await expect(loadQuotedParent(db, 'conv-1', 'missing')).resolves.toBeNull()
  })
})

/** Filter-tracking fake matching resolveInboundSwipeReply's query chain. */
function swipeReplyDb(rows: {
  inbound?: { id: string; message_id: string; reply_to_message_id: string | null }
  parent?: {
    id: string
    sender_type?: string
    content_type?: string
    content_text?: string | null
    interactive_payload?: unknown
  }
}): SupabaseClient {
  return {
    from: () => {
      const filters: Record<string, unknown> = {}
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val
          return chain
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => {
          if (typeof filters.message_id === 'string') {
            const inbound = rows.inbound
            return Promise.resolve({
              data:
                inbound && inbound.message_id === filters.message_id
                  ? inbound
                  : null,
              error: null,
            })
          }
          if (typeof filters.id === 'string') {
            const parent = rows.parent
            return Promise.resolve({
              data: parent && parent.id === filters.id ? parent : null,
              error: null,
            })
          }
          if (filters.sender_type === 'customer') {
            return Promise.resolve({ data: rows.inbound ?? null, error: null })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
      return chain
    },
  } as unknown as SupabaseClient
}

describe('resolveInboundSwipeReply', () => {
  const parent = {
    id: 'parent-1',
    sender_type: 'bot',
    content_type: 'text',
    content_text: 'We close at 8pm on Sundays.',
    interactive_payload: null,
  }

  it('loads the parent from reply_to_message_id when the inbound wamid matches', async () => {
    const db = swipeReplyDb({
      inbound: {
        id: 'inbound-1',
        message_id: 'wamid.inbound',
        reply_to_message_id: 'parent-1',
      },
      parent,
    })
    await expect(
      resolveInboundSwipeReply(db, 'conv-1', 'wamid.inbound'),
    ).resolves.toEqual({
      inboundId: 'inbound-1',
      quotedParent: parent,
    })
  })

  it('returns the inbound id with no parent when reply_to_message_id is null', async () => {
    const db = swipeReplyDb({
      inbound: {
        id: 'inbound-1',
        message_id: 'wamid.inbound',
        reply_to_message_id: null,
      },
    })
    await expect(
      resolveInboundSwipeReply(db, 'conv-1', 'wamid.inbound'),
    ).resolves.toEqual({ inboundId: 'inbound-1', quotedParent: null })
  })
})
