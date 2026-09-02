import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AI_VOICE_DEFAULTS } from '@/lib/ai/types'
import type { AiConfig } from '@/lib/ai/types'
import { LIVE_AI_GREETING_USER, LIVE_AI_HANDOFF_SPOKEN, GREETING_FALLBACK, runLiveAiTurn } from './live-ai-turn'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadShopifyConfig: vi.fn(),
  retrieveShopifyStoreContent: vi.fn(),
  buildConversationContext: vi.fn(),
  retrieveKnowledge: vi.fn(),
  generateCustomerFacingReply: vi.fn(),
  bindShopifyTools: vi.fn(),
  sendProductCards: vi.fn(),
  transcribeSpeech: vi.fn(),
  synthesizeSpeech: vi.fn(),
  persistCallTurnMessage: vi.fn(),
  call: null as Record<string, unknown> | null,
  contact: { name: 'Ada', phone: '1555000' } as Record<string, unknown> | null,
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
  retrieveShopifyStoreContent: h.retrieveShopifyStoreContent,
}))
vi.mock('@/lib/ai/context', () => ({
  buildConversationContext: h.buildConversationContext,
}))
vi.mock('@/lib/ai/knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('@/lib/ai/auto-reply', () => ({
  generateCustomerFacingReply: h.generateCustomerFacingReply,
  bindShopifyTools: h.bindShopifyTools,
  sendProductCards: h.sendProductCards,
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
        messages: [expect.objectContaining({ content: LIVE_AI_GREETING_USER })],
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
    expect(h.transcribeSpeech).toHaveBeenCalled()
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
})
