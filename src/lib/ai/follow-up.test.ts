import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AI_VOICE_DEFAULTS, type AiConfig } from './types'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  buildConversationContext: vi.fn(),
  loadContactMemory: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  enqueueAiConversationFollowUp: vi.fn(),
  removeAiConversationFollowUp: vi.fn(),
  getProductFromCatalog: vi.fn(),
  loadShopifyConfig: vi.fn(),
  loadCommerceSettings: vi.fn(),
  db: null as unknown,
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => h.db,
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./context', () => ({
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('./chat-memory', () => ({ loadContactMemory: h.loadContactMemory }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({ engineSendText: h.engineSendText }))
vi.mock('@/lib/queue/enqueue', () => ({
  enqueueAiConversationFollowUp: h.enqueueAiConversationFollowUp,
  removeAiConversationFollowUp: h.removeAiConversationFollowUp,
}))
vi.mock('@/lib/shopify', () => ({
  getProductFromCatalog: h.getProductFromCatalog,
  loadShopifyConfig: h.loadShopifyConfig,
  catalogOnlyStoreConfig: (accountId: string, extras?: Record<string, unknown>) => ({
    accountId,
    shopDomain: '',
    accessToken: '',
    isActive: false,
    shopName: null,
    primaryDomain: null,
    currency: null,
    metaCatalogId: extras?.metaCatalogId ?? null,
    lastVerifiedAt: null,
    lastCatalogSyncAt: null,
    catalogProductCount: 0,
  }),
}))
vi.mock('@/lib/shopify/commerce-config', () => ({
  loadCommerceSettings: h.loadCommerceSettings,
}))

import {
  cancelConversationFollowUp,
  drainDueConversationFollowUps,
  processConversationFollowUp,
  scheduleConversationFollowUp,
} from './follow-up'

type Msg = {
  id: string
  conversation_id: string
  sender_type: 'customer' | 'bot' | 'agent'
  created_at: string
  ai_generated?: boolean
}

type FollowRow = {
  id: string
  account_id: string
  conversation_id: string
  triggering_message_id: string
  run_at: string
  status: string
  skip_reason?: string | null
}

const ACCOUNT = 'acc-1'
const CONV = 'conv-1'
const now = Date.now()
const tCustomer = new Date(now - 20 * 60_000).toISOString()
const tBot = new Date(now - 19 * 60_000).toISOString()

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyUnlimited: true,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...AI_VOICE_DEFAULTS,
    followUpEnabled: true,
    followUpDelayMinutes: 30,
    ...overrides,
  }
}

type FollowDbState = {
  conversation: Record<string, unknown>
  messages: Msg[]
  followUps: FollowRow[]
  contacts?: Record<string, unknown>[]
  orders?: Record<string, unknown>[]
  memory?: Record<string, unknown>[]
}

function memoryDb(state: FollowDbState): SupabaseClient {
  const applyFilters = <T extends Record<string, unknown>>(
    rows: T[],
    filters: { col: string; op: 'eq' | 'gt' | 'lte'; val: unknown }[],
  ) =>
    rows.filter((row) =>
      filters.every((f) => {
        const left = row[f.col]
        if (f.op === 'eq') return left === f.val
        if (f.op === 'gt') return String(left) > String(f.val)
        return String(left) <= String(f.val)
      }),
    )

  return {
    from(table: string) {
      const filters: { col: string; op: 'eq' | 'gt' | 'lte'; val: unknown }[] =
        []
      let orderCol: string | null = null
      let orderAsc = true
      let limitN = 100
      let pendingUpdate: Record<string, unknown> | null = null
      let pendingInsert: Record<string, unknown> | null = null

      const run = () => {
        if (table === 'conversations') {
          const rows = applyFilters([state.conversation], filters)
          return rows[0] ?? null
        }
        if (table === 'messages') {
          let rows = applyFilters(state.messages as unknown as Record<string, unknown>[], filters)
          if (orderCol) {
            rows = [...rows].sort((a, b) => {
              const av = String(a[orderCol!])
              const bv = String(b[orderCol!])
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av)
            })
          }
          return rows.slice(0, limitN)
        }
        if (table === 'conversation_follow_ups') {
          if (pendingInsert) {
            const row = {
              id: `fu-${state.followUps.length + 1}`,
              skip_reason: null,
              ...pendingInsert,
            } as FollowRow
            state.followUps.push(row)
            pendingInsert = null
            return row
          }
          let rows = applyFilters(
            state.followUps as unknown as Record<string, unknown>[],
            filters,
          )
          if (pendingUpdate) {
            for (const row of rows) {
              Object.assign(row, pendingUpdate)
            }
            pendingUpdate = null
          }
          if (orderCol) {
            rows = [...rows].sort((a, b) => {
              const av = String(a[orderCol!])
              const bv = String(b[orderCol!])
              return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av)
            })
          }
          return rows.slice(0, limitN)
        }
        if (table === 'contacts') {
          return applyFilters(state.contacts ?? [], filters)
        }
        if (table === 'whatsapp_commerce_orders') {
          return applyFilters(state.orders ?? [], filters)
        }
        if (table === 'contact_ai_memory') {
          return applyFilters(state.memory ?? [], filters)
        }
        return []
      }

      const finish = async (single: boolean) => {
        const result = run()
        if (single) {
          const row = Array.isArray(result) ? result[0] ?? null : result
          return { data: row, error: null }
        }
        const rows = Array.isArray(result) ? result : result ? [result] : []
        return { data: rows, error: null }
      }

      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push({ col, op: 'eq', val })
          return chain
        },
        gt: (col: string, val: unknown) => {
          filters.push({ col, op: 'gt', val })
          return chain
        },
        lte: (col: string, val: unknown) => {
          filters.push({ col, op: 'lte', val })
          return chain
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderCol = col
          orderAsc = opts?.ascending !== false
          return chain
        },
        limit: (n: number) => {
          limitN = n
          return chain
        },
        update: (row: Record<string, unknown>) => {
          pendingUpdate = row
          return chain
        },
        insert: (row: Record<string, unknown>) => {
          pendingInsert = row
          return chain
        },
        maybeSingle: () => finish(true),
        then: (
          resolve: (v: { data: unknown; error: null }) => unknown,
        ) => finish(false).then(resolve),
      }
      return chain
    },
  } as unknown as SupabaseClient
}

const productThread = [
  { role: 'user' as const, content: 'I need a black saree for a wedding under ₹5000' },
  { role: 'assistant' as const, content: 'Here are a few black sarees under 5000.' },
]

beforeEach(() => {
  h.loadAiConfig.mockReset().mockResolvedValue(aiConfig())
  h.buildConversationContext.mockReset().mockResolvedValue(productThread)
  h.loadContactMemory.mockReset().mockResolvedValue({ facts: {} })
  h.generateReply.mockReset().mockResolvedValue({
    text: JSON.stringify({
      action: 'send',
      message: 'Were you able to find a black saree that works for the wedding under 5000?',
      reason: 'product_inquiry',
    }),
    handoff: false,
    usage: null,
  })
  h.engineSendText.mockReset().mockResolvedValue({ whatsapp_message_id: 'wamid.1' })
  h.enqueueAiConversationFollowUp.mockReset().mockResolvedValue(true)
  h.removeAiConversationFollowUp.mockReset().mockResolvedValue(undefined)
  h.getProductFromCatalog.mockReset().mockResolvedValue(null)
  h.loadShopifyConfig.mockReset().mockResolvedValue(null)
  h.loadCommerceSettings.mockReset().mockResolvedValue(null)
})

describe('scheduleConversationFollowUp', () => {
  it('schedules a delayed job using the saved delay minutes', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ followUpDelayMinutes: 15 }))
    const state = {
      conversation: {
        id: CONV,
        account_id: ACCOUNT,
        contact_id: 'ct-1',
        user_id: 'u-1',
        status: 'open',
        assigned_agent_id: null,
        ai_autoreply_disabled: false,
      },
      messages: [
        {
          id: 'm-bot',
          conversation_id: CONV,
          sender_type: 'bot' as const,
          created_at: tBot,
          ai_generated: true,
        },
        {
          id: 'm-cus',
          conversation_id: CONV,
          sender_type: 'customer' as const,
          created_at: tCustomer,
        },
      ],
      followUps: [] as FollowRow[],
    }
    await scheduleConversationFollowUp({
      db: memoryDb(state),
      accountId: ACCOUNT,
      conversationId: CONV,
    })
    expect(h.enqueueAiConversationFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT,
        conversationId: CONV,
        triggeringMessageId: 'm-bot',
      }),
      15 * 60_000,
    )
    expect(state.followUps[0]?.status).toBe('pending')
  })

  it('does not schedule when follow-up is disabled', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ followUpEnabled: false }))
    await scheduleConversationFollowUp({
      db: memoryDb({
        conversation: { id: CONV, account_id: ACCOUNT, status: 'open' },
        messages: [],
        followUps: [],
      }),
      accountId: ACCOUNT,
      conversationId: CONV,
    })
    expect(h.enqueueAiConversationFollowUp).not.toHaveBeenCalled()
  })
})

describe('cancelConversationFollowUp', () => {
  it('marks pending rows cancelled when the customer replies', async () => {
    const state = {
      conversation: { id: CONV, account_id: ACCOUNT },
      messages: [],
      followUps: [
        {
          id: 'fu-1',
          account_id: ACCOUNT,
          conversation_id: CONV,
          triggering_message_id: 'm-bot',
          run_at: new Date().toISOString(),
          status: 'pending',
        },
      ],
    }
    await cancelConversationFollowUp({
      db: memoryDb(state),
      accountId: ACCOUNT,
      conversationId: CONV,
    })
    expect(state.followUps[0].status).toBe('cancelled')
    expect(h.removeAiConversationFollowUp).toHaveBeenCalledWith('fu-1')
  })
})

describe('processConversationFollowUp', () => {
  function readyState(overrides?: Partial<FollowRow>): FollowDbState {
    return {
      conversation: {
        id: CONV,
        account_id: ACCOUNT,
        contact_id: 'ct-1',
        user_id: 'u-1',
        status: 'open',
        assigned_agent_id: null,
        ai_autoreply_disabled: false,
      },
      messages: [
        {
          id: 'm-bot',
          conversation_id: CONV,
          sender_type: 'bot' as const,
          created_at: tBot,
          ai_generated: true,
        },
        {
          id: 'm-cus',
          conversation_id: CONV,
          sender_type: 'customer' as const,
          created_at: tCustomer,
        },
      ],
      followUps: [
        {
          id: 'fu-1',
          account_id: ACCOUNT,
          conversation_id: CONV,
          triggering_message_id: 'm-bot',
          run_at: new Date(now - 1000).toISOString(),
          status: 'pending',
          ...overrides,
        },
      ],
    }
  }

  it('sends a contextual follow-up when the customer stayed silent', async () => {
    const state = readyState()
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/black saree/i),
        aiGenerated: true,
      }),
    )
    expect(h.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({ skipSpokenRewrite: true }),
    )
    expect(h.generateReply.mock.calls[0][0].tools).toBeUndefined()
    expect(state.followUps[0].status).toBe('sent')
  })

  it('skips greeting-only threads without calling the model', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Hi' },
    ])
    const state = readyState()
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(state.followUps[0].skip_reason).toBe('no_context')
  })

  it('skips when auto-reply is paused on the conversation', async () => {
    const state = readyState()
    state.conversation.ai_autoreply_disabled = true
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(state.followUps[0].skip_reason).toBe('human_takeover')
  })

  it('skips when the customer already replied', async () => {
    const state = readyState()
    state.messages.unshift({
      id: 'm-later',
      conversation_id: CONV,
      sender_type: 'customer',
      created_at: new Date(now - 5 * 60_000).toISOString(),
    })
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(state.followUps[0].status).toBe('skipped')
    expect(state.followUps[0].skip_reason).toBe('customer_replied')
  })

  it('skips human takeover, closed threads, and AI SKIP', async () => {
    const takeover = readyState()
    takeover.conversation.assigned_agent_id = 'agent-1'
    h.db = memoryDb(takeover)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(takeover.followUps[0].skip_reason).toBe('human_takeover')

    const closed = readyState()
    closed.conversation.status = 'closed'
    h.db = memoryDb(closed)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(closed.followUps[0].skip_reason).toBe('closed')

    h.generateReply.mockResolvedValue({
      text: '{"action":"skip","message":"","reason":"no_context"}',
      handoff: false,
      usage: null,
    })
    const skip = readyState()
    h.db = memoryDb(skip)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(skip.followUps[0].skip_reason).toBe('ai_skip')
  })

  it('sends only once when the same job is processed twice', async () => {
    const state = readyState()
    h.db = memoryDb(state)
    const job = {
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    }
    await processConversationFollowUp(job)
    await processConversationFollowUp(job)
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
  })

  it('skips when account ids do not match', async () => {
    const state = readyState({ account_id: 'other' })
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips generation failure, send failure, expired window, and ungrounded prices', async () => {
    h.generateReply.mockRejectedValueOnce(new Error('provider down'))
    const gen = readyState()
    h.db = memoryDb(gen)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(gen.followUps[0].skip_reason).toBe('generation_failure')

    h.generateReply.mockResolvedValue({
      text: '{"action":"send","message":"ok","reason":"x"}',
      handoff: false,
      usage: null,
    })
    h.engineSendText.mockRejectedValueOnce(new Error('meta down'))
    const send = readyState()
    h.db = memoryDb(send)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(send.followUps[0].skip_reason).toBe('send_failure')

    h.engineSendText.mockClear()
    h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'wamid.1' })
    h.generateReply.mockResolvedValue({
      text: '{"action":"send","message":"Special 2499 offer today","reason":"x"}',
      handoff: false,
      usage: null,
    })
    const ungrounded = readyState()
    h.db = memoryDb(ungrounded)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(ungrounded.followUps[0].skip_reason).toBe('ungrounded')

    const expired = readyState()
    expired.messages = expired.messages.map((m) =>
      m.sender_type === 'customer'
        ? {
            ...m,
            created_at: new Date(now - 25 * 60 * 60_000).toISOString(),
          }
        : m,
    )
    h.generateReply.mockResolvedValue({
      text: '{"action":"send","message":"Were you able to find a black saree under 5000?","reason":"product_inquiry"}',
      handoff: false,
      usage: null,
    })
    h.db = memoryDb(expired)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(expired.followUps[0].skip_reason).toBe('session_window_expired')
  })

  it('skips when the customer already paid', async () => {
    const state = readyState()
    state.contacts = [
      {
        id: 'ct-1',
        account_id: ACCOUNT,
        wa_commerce_paid_at: new Date().toISOString(),
      },
    ]
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(state.followUps[0].skip_reason).toBe('purchased')
  })

  it('skips when the last customer line is an explicit decline', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'I need a black saree for a wedding under ₹5000' },
      { role: 'assistant', content: 'Here are a few black sarees under 5000.' },
      { role: 'user', content: 'വേണ്ട' },
    ])
    const state = readyState()
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(state.followUps[0].skip_reason).toBe('declined')
  })

  it('puts the current product snapshot in the follow-up prompt, not rejected items as a pitch', async () => {
    const state = readyState()
    state.conversation = {
      ...state.conversation,
      ai_product_focus: {
        handle: 'pournami-blue',
        title: 'Pournami Blue',
        sourceMessageId: 'msg-1',
        stage: 'focused',
        setBy: 'send',
      },
    }
    state.memory = [
      {
        account_id: ACCOUNT,
        contact_id: 'ct-1',
        facts: {
          shopping: {
            maxPrice: 3000,
            colors: ['blue'],
            rejectedIds: ['old-red-saree'],
            stage: 'consideration',
          },
        },
      },
    ]
    h.getProductFromCatalog.mockResolvedValue({
      id: 'gid://shopify/Product/1',
      handle: 'pournami-blue',
      title: 'Pournami Blue',
      description: '',
      imageUrl: 'https://cdn.example/p.jpg',
      productUrl: 'https://shop.example/products/pournami-blue',
      cartUrl: null,
      checkoutUrl: 'https://shop.example/cart/1:1?checkout',
      priceMin: '2499',
      priceMax: '2499',
      currency: 'INR',
      variants: [
        {
          id: 'v1',
          variantId: '1',
          title: 'Blue / M',
          sku: 'B-M',
          price: '2499',
          compareAtPrice: null,
          available: true,
          options: [
            { name: 'Color', value: 'Blue' },
            { name: 'Size', value: 'M' },
          ],
        },
      ],
    })
    h.db = memoryDb(state)
    await processConversationFollowUp({
      accountId: ACCOUNT,
      conversationId: CONV,
      followUpId: 'fu-1',
      triggeringMessageId: 'm-bot',
    })
    const prompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(prompt).toMatch(/Pournami Blue/)
    expect(prompt).toMatch(/budget_max: 3000/)
    expect(prompt).toMatch(/Do not re-pitch rejected_products/)
    expect(prompt).toMatch(/rejected_products: old-red-saree/)
    expect(prompt).toMatch(/Current product facts/)
    expect(prompt).toMatch(/in_stock_colors: Blue/)
    expect(prompt).toMatch(/Never send a generic “are you still interested”/)
  })
})

describe('drainDueConversationFollowUps', () => {
  it('processes due pending rows through the same claim path', async () => {
    const state = {
      conversation: {
        id: CONV,
        account_id: ACCOUNT,
        contact_id: 'ct-1',
        user_id: 'u-1',
        status: 'open',
        assigned_agent_id: null,
        ai_autoreply_disabled: false,
      },
      messages: [
        {
          id: 'm-bot',
          conversation_id: CONV,
          sender_type: 'bot' as const,
          created_at: tBot,
          ai_generated: true,
        },
        {
          id: 'm-cus',
          conversation_id: CONV,
          sender_type: 'customer' as const,
          created_at: tCustomer,
        },
      ],
      followUps: [
        {
          id: 'fu-1',
          account_id: ACCOUNT,
          conversation_id: CONV,
          triggering_message_id: 'm-bot',
          run_at: new Date(now - 1000).toISOString(),
          status: 'pending',
        },
      ],
    }
    const db = memoryDb(state)
    h.db = db
    await expect(drainDueConversationFollowUps(db)).resolves.toEqual({
      processed: 1,
    })
    expect(h.engineSendText).toHaveBeenCalledTimes(1)
    expect(state.followUps[0].status).toBe('sent')
  })
})
