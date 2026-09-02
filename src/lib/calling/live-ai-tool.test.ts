import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AI_VOICE_DEFAULTS } from '@/lib/ai/types'
import type { AiConfig } from '@/lib/ai/types'
import { LIVE_AI_HANDOFF_SPOKEN } from './live-ai-turn'
import { TRANSFER_TO_HUMAN_TOOL, SEARCH_CUSTOMER_MEMORY_TOOL } from './live-ai-constants'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadShopifyConfig: vi.fn(),
  retrieveKnowledge: vi.fn(),
  bindShopifyTools: vi.fn(),
  sendProductCards: vi.fn(),
  persistCallTurnMessage: vi.fn(),
  loadLiveAiCustomerMemory: vi.fn(),
  call: null as Record<string, unknown> | null,
  contact: { phone: '1555000' } as Record<string, unknown> | null,
}))

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => {
          if (table === 'calls') return { data: h.call, error: null }
          if (table === 'contacts') return { data: h.contact, error: null }
          return { data: null, error: null }
        },
      }
      return chain
    },
  }),
}))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/shopify', () => ({
  loadShopifyConfig: h.loadShopifyConfig,
}))
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('@/lib/ai/auto-reply', () => ({
  bindShopifyTools: h.bindShopifyTools,
  sendProductCards: h.sendProductCards,
}))
vi.mock('@/lib/calling/persist-call-turn', () => ({
  persistCallTurnMessage: h.persistCallTurnMessage,
}))
vi.mock('@/lib/calling/live-ai-memory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/calling/live-ai-memory')>()
  return {
    ...actual,
    loadLiveAiCustomerMemory: h.loadLiveAiCustomerMemory,
  }
})

import { executeLiveAiTool, parseToolArguments, persistLiveAiTranscript } from './live-ai-tool'

function aiConfig(): AiConfig {
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
  }
}

beforeEach(() => {
  h.loadAiConfig.mockReset()
  h.loadShopifyConfig.mockReset()
  h.retrieveKnowledge.mockReset()
  h.bindShopifyTools.mockReset()
  h.sendProductCards.mockReset()
  h.persistCallTurnMessage.mockReset()
  h.loadLiveAiCustomerMemory.mockReset()
  h.call = {
    id: 'call-1',
    account_id: 'acct-1',
    status: 'in_progress',
    ai_answered: true,
    conversation_id: 'conv-1',
    contact_id: 'contact-1',
  }
  h.contact = { phone: '1555000' }
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.persistCallTurnMessage.mockResolvedValue({ messageId: 'm', inserted: true })
})

describe('parseToolArguments', () => {
  it('parses objects and JSON strings', () => {
    expect(parseToolArguments({ query: 'bags' })).toEqual({ query: 'bags' })
    expect(parseToolArguments('{"query":"bags"}')).toEqual({ query: 'bags' })
    expect(parseToolArguments('')).toEqual({})
  })
})

describe('executeLiveAiTool', () => {
  it('hands off via transfer_to_human and persists the spoken line', async () => {
    const result = await executeLiveAiTool({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      name: TRANSFER_TO_HUMAN_TOOL,
      arguments: {},
    })
    expect(result.handoff).toBe(true)
    expect(result.spoken).toBe(LIVE_AI_HANDOFF_SPOKEN)
    expect(h.persistCallTurnMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        conversationId: 'conv-1',
        direction: 'out',
        text: LIVE_AI_HANDOFF_SPOKEN,
      }),
    )
  })

  it('searches the knowledge base', async () => {
    h.retrieveKnowledge.mockResolvedValue(['We ship in 2 days.'])
    const result = await executeLiveAiTool({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      name: 'search_knowledge',
      arguments: { query: 'shipping' },
    })
    expect(result.handoff).toBe(false)
    expect(JSON.parse(result.output)).toEqual({ excerpts: ['We ship in 2 days.'] })
  })

  it('recalls customer chat and staff notes', async () => {
    h.loadLiveAiCustomerMemory.mockResolvedValue({
      notes: ['VIP, prefers Malayalam'],
      thread: [{ role: 'customer', text: 'Need the black bag' }],
      recall: [{ role: 'customer', text: 'Need the black bag' }],
      languageHint: 'Malayalam',
    })
    const result = await executeLiveAiTool({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      name: SEARCH_CUSTOMER_MEMORY_TOOL,
      arguments: { query: 'black bag' },
    })
    expect(result.handoff).toBe(false)
    expect(JSON.parse(result.output).hits).toEqual(
      expect.arrayContaining([expect.stringContaining('black bag')]),
    )
  })

  it('runs Shopify tools and sends product cards', async () => {
    h.loadShopifyConfig.mockResolvedValue({ shopName: 'Demo' })
    h.bindShopifyTools.mockReturnValue({
      tools: [],
      executeTool: async () => '{"ok":true}',
    })
    h.sendProductCards.mockResolvedValue(undefined)
    // bindShopifyTools pushes into the array the caller passed — simulate a card
    h.bindShopifyTools.mockImplementation(
      (_db: unknown, _shop: unknown, _phone: unknown, cards: { title: string }[]) => {
        cards.push({ title: 'Bag' })
        return {
          executeTool: async () => '{"products":[]}',
        }
      },
    )

    const result = await executeLiveAiTool({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      name: 'search_products',
      arguments: { query: 'bag' },
    })
    expect(result.handoff).toBe(false)
    expect(h.sendProductCards).toHaveBeenCalled()
  })

  it('rejects tools when the call was not AI-answered', async () => {
    h.call = { ...h.call, ai_answered: false }
    await expect(
      executeLiveAiTool({
        accountId: 'acct-1',
        userId: 'user-1',
        callId: 'call-1',
        name: 'search_products',
        arguments: {},
      }),
    ).rejects.toMatchObject({ status: 409, code: 'not_ai' })
  })
})

describe('persistLiveAiTranscript', () => {
  it('mirrors a customer line into the inbox', async () => {
    const result = await persistLiveAiTranscript({
      accountId: 'acct-1',
      callId: 'call-1',
      role: 'customer',
      text: 'I need a bag',
      itemId: 'item_1',
    })
    expect(result.persisted).toBe(true)
    expect(h.persistCallTurnMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        direction: 'in',
        text: 'I need a bag',
        seq: 'item_1',
      }),
    )
  })

  it('skips Meta recording notices so they stay out of memory', async () => {
    const result = await persistLiveAiTranscript({
      accountId: 'acct-1',
      callId: 'call-1',
      role: 'customer',
      text: 'This call will be recorded for the following purpose: quality',
    })
    expect(result.persisted).toBe(false)
    expect(h.persistCallTurnMessage).not.toHaveBeenCalled()
  })
})
