import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'
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
})
