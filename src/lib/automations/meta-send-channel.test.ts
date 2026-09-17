import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resolveTransport: vi.fn(),
  sendPageMessage: vi.fn(),
  sendTemplateMessage: vi.fn(),
  resolveTemplateRow: vi.fn(),
  expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
}))

vi.mock('@/lib/meta/channel-transport', () => ({
  resolveTransport: (...args: unknown[]) => h.resolveTransport(...args),
}))

vi.mock('@/lib/meta/graph', () => ({
  sendPageMessage: (...args: unknown[]) => h.sendPageMessage(...args),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTextMessage: vi.fn(),
  sendTemplateMessage: (...args: unknown[]) => h.sendTemplateMessage(...args),
}))

vi.mock('@/lib/whatsapp/template-body', () => ({
  resolveTemplateRow: (...args: unknown[]) => h.resolveTemplateRow(...args),
  templateContentText: () => 'Your order is on the way',
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value,
}))

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              table === 'conversations'
                ? { data: { customer_service_expires_at: h.expiresAt }, error: null }
                : { data: null, error: null },
            single: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      }
    },
  }),
}))

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendCtaUrl: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendInteractiveList: vi.fn(),
}))

import { engineSendTemplate } from '@/lib/automations/meta-send'

describe('automation send_template on Messenger', () => {
  beforeEach(() => {
    h.resolveTransport.mockReset()
    h.sendPageMessage.mockReset()
    h.sendTemplateMessage.mockReset()
    h.resolveTemplateRow.mockResolvedValue({ row: { body_text: 'Your order is on the way' } })
    h.sendPageMessage.mockResolvedValue({ messageId: 'page-mid-t' })
    h.expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
  })

  it('sends the template body text inside the 24h window', async () => {
    h.resolveTransport.mockResolvedValue({
      channel: 'messenger',
      pageId: 'page-1',
      accessToken: 'page-token',
      recipientId: 'psid-1',
    })

    const result = await engineSendTemplate({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      templateName: 'order_update',
    })

    expect(result.whatsapp_message_id).toBe('page-mid-t')
    expect(h.sendPageMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'psid-1',
        message: { text: 'Your order is on the way' },
      }),
    )
    expect(h.sendTemplateMessage).not.toHaveBeenCalled()
  })

  it('skips the template when the reply window has expired', async () => {
    h.expiresAt = new Date(Date.now() - 60_000).toISOString()
    h.resolveTransport.mockResolvedValue({
      channel: 'messenger',
      pageId: 'page-1',
      accessToken: 'page-token',
      recipientId: 'psid-1',
    })

    const result = await engineSendTemplate({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      templateName: 'order_update',
    })

    expect(result.whatsapp_message_id).toBe('')
    expect(h.sendPageMessage).not.toHaveBeenCalled()
  })
})
