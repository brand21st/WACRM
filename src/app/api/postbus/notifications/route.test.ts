import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  resolvePhone: vi.fn(),
  send: vi.fn(),
  hasWhatsApp: vi.fn(),
}))

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: (...args: unknown[]) => h.requireApiKey(...args),
}))

vi.mock('@/lib/whatsapp/resolve-conversation', () => ({
  resolveConversationByPhone: (...args: unknown[]) => h.resolvePhone(...args),
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

vi.mock('@/lib/postbus/readiness', () => ({
  accountHasWhatsAppConfig: (...args: unknown[]) => h.hasWhatsApp(...args),
}))

import { POST } from './route'
import { unauthorized } from '@/lib/api/v1/respond'

function makeDb(opts: {
  existingNotify?: Record<string, unknown> | null
  integration?: Record<string, unknown> | null
  template?: Record<string, unknown> | null
  insertError?: { code: string } | null
}) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'postbus_notifications') {
                return { data: opts.existingNotify ?? null, error: null }
              }
              if (table === 'message_templates') {
                return { data: opts.template ?? null, error: null }
              }
              return { data: null, error: null }
            },
          }),
          maybeSingle: async () => {
            if (table === 'postbus_notifications') {
              return { data: opts.existingNotify ?? null, error: null }
            }
            if (table === 'postbus_integrations') {
              return { data: opts.integration ?? null, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () =>
            opts.insertError
              ? { data: null, error: opts.insertError }
              : { data: { id: 'n-1' }, error: null },
        }),
      }),
    }),
  }
}

const integration = {
  id: 'row-1',
  account_id: 'acct-1',
  postbus_merchant_id: 'org-1',
  notification_settings: { booked: true },
  booked_template_name: 'booked_notice',
  template_language: 'en_US',
}

const template = {
  name: 'booked_notice',
  language: 'en_US',
  body_text: 'Hi {{1}}, order {{2}}',
  status: 'APPROVED',
}

beforeEach(() => {
  h.requireApiKey.mockReset()
  h.resolvePhone.mockReset()
  h.send.mockReset()
  h.hasWhatsApp.mockReset()
  h.hasWhatsApp.mockResolvedValue(true)
  h.resolvePhone.mockResolvedValue({
    conversationId: 'conv-1',
    contactId: 'c-1',
    contactCreated: false,
  })
  h.send.mockResolvedValue({
    messageId: 'msg-1',
    whatsappMessageId: 'wamid-1',
  })
})

function request(body: unknown) {
  return new Request('https://cloud.vachat.in/api/postbus/notifications', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validBody = {
  merchant_id: 'org-1',
  notification_type: 'booked',
  external_ref: 'postbus:booked:ship-1',
  to: '+919876543210',
  customer_name: 'Ada',
  shop_name: 'Shop',
  order_number: '1001',
  tracking_number: 'TRK',
  tracking_url: 'https://t.example/TRK',
}

describe('POST /api/postbus/notifications', () => {
  it('rejects a missing API key', async () => {
    h.requireApiKey.mockRejectedValue(unauthorized())
    const res = await POST(request(validBody))
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.error.code).toBe('unauthorized')
  })

  it('rejects merchant mismatch', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({ integration }),
      accountId: 'acct-1',
      scopes: ['messages:send'],
    })
    const res = await POST(request({ ...validBody, merchant_id: 'other-org' }))
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.error.code).toBe('invalid_merchant_mapping')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('rejects an invalid phone', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({}),
      accountId: 'acct-1',
    })
    const res = await POST(request({ ...validBody, to: 'not-a-phone' }))
    expect((await res.json()).error.code).toBe('bad_request')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('rejects a missing template mapping', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        integration: { ...integration, booked_template_name: null },
      }),
      accountId: 'acct-1',
    })
    const res = await POST(request(validBody))
    expect((await res.json()).error.code).toBe('template_missing')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('rejects a disabled event', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        integration: { ...integration, notification_settings: { booked: false } },
      }),
      accountId: 'acct-1',
      scopes: ['messages:send'],
    })
    const res = await POST(request(validBody))
    expect((await res.json()).error.code).toBe('notification_disabled')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('rejects a globally disabled event as a kill switch', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        integration: {
          ...integration,
          routing_mode: 'global',
          notification_settings: { booked: false },
        },
      }),
      accountId: 'acct-1',
      scopes: ['postbus:send'],
    })
    const res = await POST(request(validBody))
    expect((await res.json()).error.code).toBe('notification_disabled')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('returns the original ids on duplicate external_ref without sending again', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        existingNotify: {
          id: 'n-old',
          message_id: 'msg-old',
          whatsapp_message_id: 'wamid-old',
          conversation_id: 'conv-old',
          contact_id: 'c-old',
          status: 'sent',
        },
      }),
      accountId: 'acct-1',
    })
    const res = await POST(request(validBody))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.duplicate).toBe(true)
    expect(body.data.message_id).toBe('msg-old')
    expect(h.send).not.toHaveBeenCalled()
  })

  it('sends via sendMessageToConversation for a valid key and mapping', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({ integration, template }),
      accountId: 'acct-1',
      scopes: ['messages:send'],
    })
    const res = await POST(request(validBody))
    const body = await res.json()
    expect(res.status).toBe(201)
    expect(body.data.message_id).toBe('msg-1')
    expect(h.send).toHaveBeenCalledTimes(1)
    expect(h.requireApiKey).toHaveBeenCalledWith(expect.anything(), [
      'messages:send',
      'postbus:send',
    ])
  })

  it('sends in global mode for any merchant_id when the key has postbus:send', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        integration: {
          ...integration,
          routing_mode: 'global',
          postbus_merchant_id: null,
        },
        template,
      }),
      accountId: 'acct-1',
      scopes: ['postbus:send'],
    })
    const res = await POST(request({ ...validBody, merchant_id: 'other-org' }))
    expect(res.status).toBe(201)
    expect(h.send).toHaveBeenCalledTimes(1)
  })

  it('rejects global mode without postbus:send', async () => {
    h.requireApiKey.mockResolvedValue({
      supabase: makeDb({
        integration: { ...integration, routing_mode: 'global' },
        template,
      }),
      accountId: 'acct-1',
      scopes: ['messages:send'],
    })
    const res = await POST(request({ ...validBody, merchant_id: 'other-org' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error.code).toBe('forbidden')
    expect(h.send).not.toHaveBeenCalled()
  })
})
