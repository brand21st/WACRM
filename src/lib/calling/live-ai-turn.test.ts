import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AI_VOICE_DEFAULTS } from '@/lib/ai/types'
import type { AiConfig } from '@/lib/ai/types'
import {
  LIVE_AI_GREETING_NEUTRAL,
  LIVE_AI_GREETING_USER,
  LIVE_AI_HANDOFF_SPOKEN,
  GREETING_FALLBACK,
  runLiveAiTurn,
} from './live-ai-turn'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadShopifyConfig: vi.fn(),
  retrieveShopifyStoreContent: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateCustomerFacingReply: vi.fn(),
  bindShopifyTools: vi.fn(),
  sendProductCards: vi.fn(),
  sendWhatsAppCatalogMessage: vi.fn(),
  transcribeSpeech: vi.fn(),
  synthesizeSpeech: vi.fn(),
  persistCallTurnMessage: vi.fn(),
  loadContactMemory: vi.fn(),
  emptyMemory: (facts: Record<string, unknown> = {}) => ({
    profileSummary: '',
    lastSessionSummary: '',
    facts: {
      intent: null,
      products: [],
      preferences: [],
      language: null,
      language_code: null,
      language_script: null,
      language_locked: false,
      open_questions: [],
      ...facts,
    },
    notes: [],
    summarizedThroughAt: null,
    messageCountAtSummary: 0,
    conversationId: null,
  }),
  call: null as Record<string, unknown> | null,
  contact: { name: 'Ada', phone: '1555000' } as Record<string, unknown> | null,
  settings: null as Record<string, unknown> | null,
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
          if (table === 'calling_settings') return { data: h.settings, error: null }
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
  retrieveShopifyStoreContent: h.retrieveShopifyStoreContent,
}))
vi.mock('@/lib/shopify/commerce-config', () => ({
  loadCommerceSettings: async () => ({
    metaCatalogId: null,
    waPaymentConfigurationName: null,
    retailerIdSource: 'sku',
  }),
}))
vi.mock('@/lib/ai/context', () => ({
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('@/lib/ai/chat-memory', () => ({
  loadContactMemory: (...args: unknown[]) => h.loadContactMemory(...args),
  persistLanguageLock: async ({ existing, lock }: { existing: { facts: Record<string, unknown> }; lock: { name: string; code: string; script: string } }) => ({
    ...existing,
    facts: {
      ...existing.facts,
      language: lock.name,
      language_code: lock.code,
      language_script: lock.script,
      language_locked: true,
    },
  }),
  formatCustomerMemoryBlock: () => '',
  emptyContactMemory: () => h.emptyMemory(),
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  generateCustomerFacingReply: h.generateCustomerFacingReply,
  bindShopifyTools: h.bindShopifyTools,
  sendProductCards: h.sendProductCards,
  sendWhatsAppCatalogMessage: h.sendWhatsAppCatalogMessage,
}))
vi.mock('@/lib/ai/speech', () => ({
  canTranscribe: () => true,
  canSpeak: () => true,
  transcribeSpeech: h.transcribeSpeech,
  synthesizeSpeech: h.synthesizeSpeech,
}))
vi.mock('@/lib/calling/persist-call-turn', () => ({
  persistCallTurnMessage: h.persistCallTurnMessage,
}))

import { __resetRateLimitForTests } from '@/lib/rate-limit'

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
    elevenlabsApiKey: 'xi-test',
    sttEnabled: true,
    ttsEnabled: true,
  }
}

describe('runLiveAiTurn', () => {
  beforeEach(() => {
    __resetRateLimitForTests()
    h.call = {
      id: 'call-1',
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      contact_id: 'contact-1',
      status: 'in_progress',
      ai_answered: true,
    }
    h.settings = null
    h.loadAiConfig.mockResolvedValue(aiConfig())
    h.loadShopifyConfig.mockResolvedValue(null)
    h.retrieveShopifyStoreContent.mockResolvedValue([])
    h.buildConversationContext.mockResolvedValue([])
    h.retrieveKnowledge.mockResolvedValue([])
    h.bindShopifyTools.mockImplementation(
      (
        _db: unknown,
        shopify: unknown,
        _phone: unknown,
        cards: Array<{ title: string }>,
      ) => {
        if (shopify) {
          cards.push({ title: 'Red bag' })
          return { tools: [{ name: 'search_products' }], executeTool: vi.fn() }
        }
        return {}
      },
    )
    h.generateCustomerFacingReply.mockResolvedValue({
      text: 'We have that in stock.',
      handoff: false,
    })
    h.sendProductCards.mockResolvedValue(undefined)
    h.transcribeSpeech.mockResolvedValue('Do you have bags?')
    h.synthesizeSpeech.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/mpeg',
    })
    h.persistCallTurnMessage.mockResolvedValue({ messageId: 'm', inserted: true })
    h.loadContactMemory.mockReset()
    h.loadContactMemory.mockResolvedValue(h.emptyMemory())
  })

  it('greets without STT and persists the bot line', async () => {
    const result = await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'greeting',
    })
    expect(h.transcribeSpeech).not.toHaveBeenCalled()
    expect(h.generateCustomerFacingReply).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ content: LIVE_AI_GREETING_NEUTRAL })],
      }),
    )
    expect(h.persistCallTurnMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ direction: 'out', text: 'We have that in stock.' }),
    )
    expect(result.audioBase64).toBe(Buffer.from([1, 2, 3]).toString('base64'))
    expect(h.sendProductCards).not.toHaveBeenCalled()
    expect(h.bindShopifyTools).toHaveBeenCalledWith(
      expect.anything(),
      null,
      '1555000',
      expect.any(Array),
      expect.anything(),
    )
  })

  it('injects call behaviour into the turn system prompt', async () => {
    h.settings = {
      live_ai_behaviour: 'Warm and brief',
      live_ai_business_context: 'We sell bags.',
      live_ai_instructions: 'Never quote prices.',
      live_ai_answer: 'ai_first',
      live_ai_voice: 'openai',
    }
    h.loadAiConfig.mockResolvedValue({
      ...aiConfig(),
      systemPrompt: 'Chat-only rules',
    })
    await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'greeting',
    })
    const systemPrompt = h.generateCustomerFacingReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Call behaviour:')
    expect(systemPrompt).toContain('Warm and brief')
    expect(systemPrompt).toContain('We sell bags.')
    expect(systemPrompt).toContain('Never quote prices.')
    expect(systemPrompt).not.toContain('Chat-only rules')
  })

  it('transcribes an utterance, persists both sides, and uses Shopify tools when connected', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 't',
      isActive: true,
      shopName: 'Acme',
    })
    const result = await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(h.loadContactMemory).toHaveBeenCalled()
    expect(h.transcribeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ languageHint: undefined }),
    )
    expect(h.persistCallTurnMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ direction: 'in', text: 'Do you have bags?' }),
    )
    expect(h.sendProductCards).toHaveBeenCalled()
    expect(h.generateCustomerFacingReply.mock.calls[0][0].tools).toEqual([
      { name: 'search_products' },
    ])
    expect(result.transcript).toBe('Do you have bags?')
    expect(result.handoff).toBe(false)
  })

  it('skips empty transcripts', async () => {
    h.transcribeSpeech.mockResolvedValue('   ')
    const result = await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(result.skipped).toBe(true)
    expect(h.generateCustomerFacingReply).not.toHaveBeenCalled()
    expect(h.persistCallTurnMessage).not.toHaveBeenCalled()
  })

  it('does not send catalog cards when Shopify is disconnected', async () => {
    await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(h.sendProductCards).not.toHaveBeenCalled()
    expect(h.generateCustomerFacingReply.mock.calls[0][0].tools).toBeUndefined()
  })

  it('speaks the handoff line and skips product cards', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 't',
      isActive: true,
    })
    h.generateCustomerFacingReply.mockResolvedValue({
      text: 'Need a human',
      handoff: true,
    })
    const result = await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(result.handoff).toBe(true)
    expect(result.reply).toBe(LIVE_AI_HANDOFF_SPOKEN)
    expect(h.sendProductCards).not.toHaveBeenCalled()
  })

  it('persistOnly greeting skips generation and TTS', async () => {
    const result = await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'greeting',
      persistOnly: true,
      spokenReply: GREETING_FALLBACK,
    })
    expect(h.generateCustomerFacingReply).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.persistCallTurnMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ direction: 'out', text: GREETING_FALLBACK }),
    )
    expect(result.reply).toBe(GREETING_FALLBACK)
    expect(result.audioBase64).toBeNull()
  })

  it('greets in the locked language when a prior chat lock exists', async () => {
    h.loadContactMemory.mockResolvedValue(
      h.emptyMemory({
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'native',
        language_locked: true,
      }),
    )
    await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'greeting',
    })
    expect(h.generateCustomerFacingReply).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [expect.objectContaining({ content: LIVE_AI_GREETING_USER })],
        replyLanguage: expect.objectContaining({ code: 'ml', locked: true }),
      }),
    )
  })

  it('does not hint STT from a soft cron language guess', async () => {
    h.loadContactMemory.mockResolvedValue(
      h.emptyMemory({
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'native',
        language_locked: false,
      }),
    )
    await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(h.transcribeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ languageHint: undefined }),
    )
  })

  it('hints STT from a hard language lock', async () => {
    h.loadContactMemory.mockResolvedValue(
      h.emptyMemory({
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'native',
        language_locked: true,
      }),
    )
    await runLiveAiTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      kind: 'utterance',
      audio: { bytes: Buffer.from([9]), mimeType: 'audio/webm', fileName: 'u.webm' },
    })
    expect(h.transcribeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ languageHint: 'ml' }),
    )
  })
})
