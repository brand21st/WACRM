import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  fanout: vi.fn(),
  resolve: vi.fn(),
  inserted: [{ id: 'msg-1' }] as { id: string }[] | [],
  connection: {
    account_id: 'acct-1',
    user_id: 'user-1',
    page_id: 'page-1',
    ig_user_id: 'ig-1',
    access_token: 'page-token',
    messenger_status: 'connected',
    instagram_status: 'connected',
    mirror_inbound_media: true,
  },
}))

function thenable(result: unknown) {
  const chain: Record<string, unknown> = {}
  const self = () => chain
  chain.select = self
  chain.eq = self
  chain.or = self
  chain.neq = self
  chain.not = self
  chain.update = self
  chain.insert = self
  chain.maybeSingle = async () => result
  chain.single = async () => result
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from(table: string) {
      if (table === 'meta_page_connections') {
        return thenable({ data: h.connection, error: null })
      }
      if (table === 'messages') {
        return {
          select: (_cols?: string, opts?: { count?: string }) => {
            if (opts?.count) {
              return thenable({ data: null, error: null, count: 1 })
            }
            return thenable({ data: null, error: null })
          },
          upsert: () => ({
            select: async () => ({ data: h.inserted, error: null }),
          }),
          update: () => thenable({ data: null, error: null }),
        }
      }
      if (table === 'conversations') {
        return {
          select: () => thenable({
            data: {
              id: 'conv-1',
              assigned_agent_id: null,
              ai_autoreply_disabled: false,
              last_message_text: null,
              status: 'open',
            },
            error: null,
          }),
          update: () => thenable({ data: null, error: null }),
        }
      }
      if (table === 'contacts') {
        return thenable({
          data: { id: 'contact-1', phone: null, name: 'Jane' },
          error: null,
        })
      }
      return thenable({ data: null, error: null })
    },
  }),
}))

vi.mock('@/lib/inbox/inbound-fanout', () => ({
  dispatchInboundFanout: (...args: unknown[]) => h.fanout(...args),
}))

vi.mock('@/lib/meta/resolve-conversation', () => ({
  resolveConversationByChannelUser: (...args: unknown[]) => h.resolve(...args),
}))

vi.mock('@/lib/meta/graph', () => ({
  getUserProfile: async () => ({ name: 'Jane', profilePic: null }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value,
}))

vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: vi.fn(),
}))

vi.mock('@/lib/api/v1/contacts', () => ({
  resolveAuditUserId: async () => 'user-1',
}))

import { processMetaWebhookPayload } from '@/lib/meta/webhook'

describe('processMetaWebhookPayload', () => {
  beforeEach(() => {
    h.fanout.mockReset()
    h.resolve.mockReset()
    h.resolve.mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: false,
    })
    h.inserted = [{ id: 'msg-1' }]
  })

  it('persists a Messenger inbound and invokes fan-out', async () => {
    await processMetaWebhookPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'psid-1' },
              recipient: { id: 'page-1' },
              message: { mid: 'mid-1', text: 'hello' },
            },
          ],
        },
      ],
    })
    expect(h.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'messenger',
        channelUserId: 'psid-1',
      }),
    )
    expect(h.fanout).toHaveBeenCalledTimes(1)
    expect(h.fanout).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        channel: 'messenger',
        contentText: 'hello',
        metaMessageId: 'mid-1',
      }),
    )
  })

  it('persists an Instagram inbound and invokes fan-out', async () => {
    await processMetaWebhookPayload({
      object: 'instagram',
      entry: [
        {
          id: 'ig-1',
          messaging: [
            {
              sender: { id: 'igsid-1' },
              recipient: { id: 'ig-1' },
              message: { mid: 'mid-ig', text: 'hi from ig' },
            },
          ],
        },
      ],
    })
    expect(h.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'instagram',
        channelUserId: 'igsid-1',
      }),
    )
    expect(h.fanout).toHaveBeenCalledTimes(1)
  })

  it('does not fan out echoes', async () => {
    await processMetaWebhookPayload({
      object: 'page',
      entry: [
        {
          id: 'page-1',
          messaging: [
            {
              sender: { id: 'page-1' },
              recipient: { id: 'psid-1' },
              message: { mid: 'mid-echo', text: 'agent echo', is_echo: true },
            },
          ],
        },
      ],
    })
    expect(h.resolve).toHaveBeenCalled()
    expect(h.fanout).not.toHaveBeenCalled()
  })
})
