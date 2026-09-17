import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveTransport: vi.fn(),
  sendPageMessage: vi.fn(),
  sendTextMessage: vi.fn(),
  inserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/meta/channel-transport', () => ({
  resolveTransport: (...args: unknown[]) => h.resolveTransport(...args),
}))

vi.mock('@/lib/meta/graph', () => ({
  sendPageMessage: (...args: unknown[]) => h.sendPageMessage(...args),
  sendPageSenderAction: vi.fn(),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: (...args: unknown[]) => h.sendTextMessage(...args),
  sendMediaMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
  sendInteractiveCtaUrl: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value,
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      return {
        insert: async (row: Record<string, unknown>) => {
          if (table === 'messages') h.inserts.push(row)
          return { error: null }
        },
        update: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
              single: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }
    },
  }),
}))

import { engineSendText } from '@/lib/flows/meta-send'

describe('engineSendText channel routing', () => {
  beforeEach(() => {
    h.resolveTransport.mockReset()
    h.sendPageMessage.mockReset()
    h.sendTextMessage.mockReset()
    h.inserts = []
    h.sendPageMessage.mockResolvedValue({ messageId: 'page-mid-1' })
  })

  it('sends Instagram replies through Page Messaging, not WhatsApp Cloud', async () => {
    h.resolveTransport.mockResolvedValue({
      channel: 'instagram',
      pageId: 'page-1',
      accessToken: 'page-token',
      recipientId: 'igsid-1',
    })

    const result = await engineSendText({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      text: 'Thanks for writing',
    })

    expect(result.whatsapp_message_id).toBe('page-mid-1')
    expect(h.sendPageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-1',
        pageAccessToken: 'page-token',
        recipientId: 'igsid-1',
        message: { text: 'Thanks for writing' },
      }),
    )
    expect(h.sendTextMessage).not.toHaveBeenCalled()
  })
})
