import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { handleShopifyNotificationWebhook } from './notifications'

const sendTemplateMessage = vi.fn()
const resolveConversationByPhone = vi.fn()

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: (...args: unknown[]) => sendTemplateMessage(...args),
}))

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: (...args: unknown[]) =>
    resolveConversationByPhone(...args),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: () => 'wa-token',
}))

vi.mock('./config', () => ({
  loadShopifyConfig: vi.fn(async () => null),
}))

function chain(result: unknown) {
  const self: Record<string, unknown> = {}
  const ret = () => self
  self.select = vi.fn(ret)
  self.eq = vi.fn(ret)
  self.in = vi.fn(ret)
  self.maybeSingle = vi.fn(async () => result)
  self.single = vi.fn(async () => result)
  self.limit = vi.fn(async () => result)
  self.order = vi.fn(ret)
  self.lte = vi.fn(ret)
  self.then = (resolve: (v: unknown) => unknown) => resolve(result)
  return self
}

function mockDb(opts: { sendInsertError?: { code: string } | null }) {
  const sendInserts: unknown[] = []
  const from = vi.fn((table: string) => {
    if (table === 'shopify_notification_rules') {
      return chain({
        data: [
          {
            trigger_key: 'new_order',
            is_enabled: true,
            template_name: 'order_confirm',
            template_language: 'en_US',
            variable_map: { '1': 'order_name', '2': 'total' },
            config: {},
          },
        ],
        error: null,
      })
    }
    if (table === 'shopify_notification_jobs') {
      return chain({ data: [], error: null })
    }
    if (table === 'shopify_notification_sends') {
      return {
        insert: vi.fn((row: unknown) => {
          sendInserts.push(row)
          if (opts.sendInsertError && sendInserts.length > 1) {
            return chain({ data: null, error: opts.sendInsertError })
          }
          return chain({ data: { id: `send-${sendInserts.length}` }, error: null })
        }),
        update: vi.fn(() => chain({ data: {}, error: null })),
        delete: vi.fn(() => chain({ data: {}, error: null })),
      }
    }
    if (table === 'whatsapp_config') {
      return chain({
        data: { phone_number_id: 'pn', access_token: 'enc' },
        error: null,
      })
    }
    if (table === 'message_templates') {
      return chain({
        data: [
          {
            id: 't1',
            user_id: 'u1',
            name: 'order_confirm',
            language: 'en_US',
            category: 'Utility',
            body_text: 'Order {{1}} total {{2}}',
            status: 'APPROVED',
          },
        ],
        error: null,
      })
    }
    if (table === 'messages') {
      return {
        insert: vi.fn(async () => ({ error: null })),
      }
    }
    return chain({ data: null, error: null })
  })
  return { db: { from } as unknown as SupabaseClient, sendInserts }
}

const ORDER = {
  id: 1001,
  name: '#1001',
  current_total_price: '42.00',
  currency: 'INR',
  customer: { first_name: 'Ada', phone: '+14155550123' },
}

describe('handleShopifyNotificationWebhook', () => {
  beforeEach(() => {
    sendTemplateMessage.mockReset()
    resolveConversationByPhone.mockReset()
    sendTemplateMessage.mockResolvedValue({ messageId: 'wamid.1' })
    resolveConversationByPhone.mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'c-1',
      contactCreated: false,
    })
  })

  it('sends the mapped template for a new order', async () => {
    const { db } = mockDb({})
    await handleShopifyNotificationWebhook(db, 'acct-1', 'orders/create', ORDER)
    expect(resolveConversationByPhone).toHaveBeenCalled()
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
    expect(sendTemplateMessage.mock.calls[0][0].templateName).toBe('order_confirm')
    expect(sendTemplateMessage.mock.calls[0][0].params).toEqual(['#1001', '42.00'])
  })

  it('does not send twice when the send log already exists', async () => {
    const { db } = mockDb({ sendInsertError: { code: '23505' } })
    await handleShopifyNotificationWebhook(db, 'acct-1', 'orders/create', ORDER)
    await handleShopifyNotificationWebhook(db, 'acct-1', 'orders/create', ORDER)
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1)
  })
})
