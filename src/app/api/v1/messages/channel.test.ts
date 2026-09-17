import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolvePhone: vi.fn(),
  resolveChannel: vi.fn(),
  send: vi.fn(),
}))

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: (...args: unknown[]) => h.requireApiKey(...args),
}))

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: (...args: unknown[]) => h.resolvePhone(...args),
}))

vi.mock('@/lib/meta/resolve-conversation', () => ({
  resolveConversationByChannelUser: (...args: unknown[]) => h.resolveChannel(...args),
}))

vi.mock('@/lib/whatsapp/send-message', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/send-message')>(
    '@/lib/whatsapp/send-message',
  )
  return {
    ...actual,
    sendMessageToConversation: (...args: unknown[]) => h.send(...args),
  }
})

import { POST } from './route'

describe('POST /api/v1/messages channel', () => {
  beforeEach(() => {
    h.requireApiKey.mockReset()
    h.resolvePhone.mockReset()
    h.resolveChannel.mockReset()
    h.send.mockReset()
    h.requireApiKey.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
    })
    h.resolveChannel.mockResolvedValue({
      conversationId: 'conv-ig',
      contactId: 'contact-ig',
      contactCreated: true,
    })
    h.send.mockResolvedValue({
      messageId: 'msg-1',
      whatsappMessageId: 'mid-1',
    })
  })

  it('resolves Instagram recipients by scoped id', async () => {
    const res = await POST(
      new Request('https://cloud.vachat.in/api/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: '17841400000000000',
          channel: 'instagram',
          type: 'text',
          text: 'Hi',
        }),
      }),
    )
    expect(res.status).toBe(201)
    expect(h.resolvePhone).not.toHaveBeenCalled()
    expect(h.resolveChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        channel: 'instagram',
        channelUserId: '17841400000000000',
      }),
    )
    expect(h.send).toHaveBeenCalled()
  })
})
