import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sendMediaMessage: vi.fn(),
  decrypt: vi.fn((v: string) => v),
  inserts: [] as Record<string, unknown>[],
  updates: [] as { table: string; payload: Record<string, unknown> }[],
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendMediaMessage: h.sendMediaMessage,
  sendTextMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}))
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: h.decrypt }))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'contacts') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'contact-1', phone: '+15551212' },
                  error: null,
                }),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            h.updates.push({ table, payload })
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  phone_number_id: 'pnid',
                  access_token: 'tok',
                },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'messages') {
        return {
          insert: (row: Record<string, unknown>) => {
            h.inserts.push(row)
            return Promise.resolve({ error: null })
          },
        }
      }
      if (table === 'conversations') {
        return {
          update: (payload: Record<string, unknown>) => {
            h.updates.push({ table, payload })
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      return {}
    },
  }),
}))

import { engineSendMedia } from './meta-send'

beforeEach(() => {
  h.inserts.length = 0
  h.updates.length = 0
  h.sendMediaMessage.mockResolvedValue({ messageId: 'wamid.audio' })
})

describe('engineSendMedia — generated audio persistence', () => {
  it('persists media_url, transcript, ai_generated, Meta id, and sent status', async () => {
    const result = await engineSendMedia({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      kind: 'audio',
      link: 'https://cdn.example/ai-reply.mp3',
      mediaType: 'audio/mpeg',
      contentText: 'Hello from the bot',
      aiGenerated: true,
    })

    expect(result.whatsapp_message_id).toBe('wamid.audio')
    expect(h.sendMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audio',
        link: 'https://cdn.example/ai-reply.mp3',
      }),
    )
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      content_type: 'audio',
      content_text: 'Hello from the bot',
      media_url: 'https://cdn.example/ai-reply.mp3',
      media_type: 'audio/mpeg',
      message_id: 'wamid.audio',
      status: 'sent',
      ai_generated: true,
    })
  })
})
