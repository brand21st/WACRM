import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AiConfig } from './types'
import { AI_VOICE_DEFAULTS } from './types'
import { FULL_AGENT_FALLBACK_REPLY } from './defaults'

// Shared, hoisted mock state so the module mocks can close over it.
const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  loadShopifyConfig: vi.fn(),
  executeShopifyTool: vi.fn(),
  matchProductsFromPhoto: vi.fn(),
  toCard: vi.fn(),
  getProductLive: vi.fn(),
  buildCartOffer: vi.fn(),
  resolveCartOfferItems: vi.fn(),
  cartOfferFallbackText: vi.fn(),
  buildConversationContext: vi.fn(),
  loadContactMemory: vi.fn(),
  persistLanguageLock: vi.fn(),
  formatCustomerMemoryBlock: vi.fn(),
  emptyContactMemory: vi.fn(),
  retrieveKnowledge: vi.fn(),
  retrieveShopifyStoreContent: vi.fn(),
  generateReply: vi.fn(),
  engineSendText: vi.fn(),
  engineSendInteractiveButtons: vi.fn(),
  engineSendCtaUrl: vi.fn(),
  engineSendProduct: vi.fn(),
  engineSendProductList: vi.fn(),
  loadCommerceSettings: vi.fn(),
  engineSendMedia: vi.fn(),
  engineSendTypingIndicator: vi.fn(),
  textToSpeech: vi.fn(),
  synthesizeSpeech: vi.fn(),
  uploadGeneratedAudio: vi.fn(),
  rehostPublicImage: vi.fn(),
  realtimeTurn: vi.fn(),
  pcm16ToOggOpus: vi.fn(),
  state: {
    conv: null as Record<string, unknown> | null,
    autoResponders: [] as { id: string }[],
    liveCalls: [] as { id: string }[],
    claim: true as boolean,
    updatePayload: null as Record<string, unknown> | null,
    rpcCalls: [] as { name: string; args: unknown }[],
    contactName: null as string | null,
  },
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('@/lib/shopify', () => ({
  loadShopifyConfig: h.loadShopifyConfig,
  executeShopifyTool: h.executeShopifyTool,
  matchProductsFromPhoto: h.matchProductsFromPhoto,
  toCard: h.toCard,
  getProductLive: h.getProductLive,
  retrieveShopifyStoreContent: h.retrieveShopifyStoreContent,
  buildCartOffer: h.buildCartOffer,
  resolveCartOfferItems: h.resolveCartOfferItems,
  cartOfferFallbackText: h.cartOfferFallbackText,
  SHOPIFY_LLM_TOOLS: [
    {
      name: 'search_products',
      description: 'search',
      parameters: { type: 'object', properties: { query: { type: 'string' } } },
    },
    {
      name: 'offer_cart',
      description: 'cart',
      parameters: { type: 'object', properties: {} },
    },
  ],
}))
vi.mock('./context', () => ({ buildConversationContext: h.buildConversationContext }))
vi.mock('./chat-memory', () => ({
  loadContactMemory: h.loadContactMemory,
  persistLanguageLock: h.persistLanguageLock,
  formatCustomerMemoryBlock: h.formatCustomerMemoryBlock,
  emptyContactMemory: h.emptyContactMemory,
}))
vi.mock('./knowledge', () => ({ retrieveKnowledge: h.retrieveKnowledge }))
vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('@/lib/flows/meta-send', () => ({
  engineSendText: h.engineSendText,
  engineSendInteractiveButtons: h.engineSendInteractiveButtons,
  engineSendCtaUrl: h.engineSendCtaUrl,
  engineSendProduct: h.engineSendProduct,
  engineSendProductList: h.engineSendProductList,
  engineSendMedia: h.engineSendMedia,
  engineSendTypingIndicator: h.engineSendTypingIndicator,
}))
vi.mock('@/lib/shopify/commerce-config', () => ({
  loadCommerceSettings: h.loadCommerceSettings,
}))
vi.mock('@/lib/commerce/checkout', () => ({
  tryCompleteCommerceAddress: vi.fn(async () => false),
  tryCompleteCommerceDiscount: vi.fn(async () => false),
  tryCompleteCommerceEmail: vi.fn(async () => false),
}))
vi.mock('./speech', () => ({
  canSpeak: (config: { ttsEnabled: boolean; voiceProvider: string; elevenlabsApiKey: string | null; sarvamApiKey: string | null }) =>
    config.ttsEnabled &&
    (config.voiceProvider === 'sarvam'
      ? Boolean(config.sarvamApiKey)
      : Boolean(config.elevenlabsApiKey)),
  synthesizeSpeech: h.synthesizeSpeech,
}))
vi.mock('@/lib/elevenlabs/storage', () => ({
  uploadGeneratedAudio: h.uploadGeneratedAudio,
}))
vi.mock('@/lib/storage/generated-media', () => ({
  rehostPublicImage: h.rehostPublicImage,
}))
vi.mock('./realtime', () => ({ realtimeTurn: h.realtimeTurn }))
vi.mock('@/lib/audio/pcm-to-opus', () => ({
  pcm16ToOggOpus: h.pcm16ToOggOpus,
}))
vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'calls') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.liveCalls, error: null }),
        }
        return chain
      }
      if (table === 'automations') {
        // .select().eq().eq().in().limit() → active auto-responders
        const chain = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          limit: () =>
            Promise.resolve({ data: h.state.autoResponders, error: null }),
        }
        return chain
      }
      // conversations (and other simple lookups like contacts)
      const convChain = {
        select: () => convChain,
        eq: () => convChain,
        maybeSingle: () => {
          if (table === 'contacts') {
            return Promise.resolve({
              data: { phone: '15551212', name: h.state.contactName },
              error: null,
            })
          }
          return Promise.resolve({ data: h.state.conv, error: null })
        },
      }
      return {
        ...convChain,
        update: (payload: Record<string, unknown>) => {
          h.state.updatePayload = payload
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
    rpc: (name: string, args: unknown) => {
      h.state.rpcCalls.push({ name, args })
      return Promise.resolve({ data: h.state.claim, error: null })
    },
  }),
}))

import { __resetRateLimitForTests } from '@/lib/rate-limit'
import { dispatchInboundToAiReply } from './auto-reply'

const ARGS = {
  accountId: 'acct-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
}

function aiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyUnlimited: false,
    autoReplyMaxPerConversation: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
    ...AI_VOICE_DEFAULTS,
    ...overrides,
  }
}

beforeEach(() => {
  __resetRateLimitForTests()
  h.state.conv = {
    assigned_agent_id: null,
    ai_autoreply_disabled: false,
    ai_reply_count: 0,
  }
  h.state.autoResponders = []
  h.state.liveCalls = []
  h.state.claim = true
  h.state.updatePayload = null
  h.state.rpcCalls = []
  h.state.contactName = null
  h.loadAiConfig.mockResolvedValue(aiConfig())
  h.loadShopifyConfig.mockResolvedValue(null)
  h.loadCommerceSettings.mockResolvedValue({
    metaCatalogId: null,
    metaCatalogAutoSync: false,
    lastMetaCatalogSyncAt: null,
    metaCatalogItemCount: 0,
    retailerIdSource: 'sku',
    waPaymentConfigurationName: null,
    razorpayKeyId: null,
    hasRazorpaySecret: false,
    hasRazorpayWebhookSecret: false,
    shipBeneficiary: null,
  })
  h.executeShopifyTool.mockResolvedValue({ json: '{}', cards: [] })
  h.buildCartOffer.mockReturnValue(null)
  h.resolveCartOfferItems.mockResolvedValue([])
  h.cartOfferFallbackText.mockImplementation(
    (items: { title: string; quantity: number; price?: string | null }[]) =>
      items.length === 0
        ? ''
        : `Here is your cart:\n${items.map((i) => `• ${i.title}`).join('\n')}`,
  )
  h.matchProductsFromPhoto.mockResolvedValue([])
  h.getProductLive.mockResolvedValue(null)
  h.rehostPublicImage.mockResolvedValue('https://cdn.example/hosted.jpg')
  h.toCard.mockImplementation((p: {
    title: string
    imageUrl?: string | null
    productUrl?: string
    cartUrl?: string | null
    checkoutUrl?: string | null
    priceMin?: string | null
    priceMax?: string | null
    currency?: string | null
    variants?: {
      available: boolean
      title?: string
      price?: string | null
      options?: { name: string; value: string }[]
    }[]
  }) => {
    const inStock =
      p.variants && p.variants.length > 0
        ? p.variants.some((v) => v.available)
        : Boolean(p.checkoutUrl)
    const price =
      p.priceMin && p.priceMax && p.priceMin !== p.priceMax
        ? `${p.priceMin}–${p.priceMax}${p.currency ? ` ${p.currency}` : ''}`
        : `${p.priceMin ?? ''}${p.currency ? ` ${p.currency}` : ''}`.trim()
    const sizes: string[] = []
    const colors: string[] = []
    const seenSize = new Set<string>()
    const seenColor = new Set<string>()
    for (const v of p.variants ?? []) {
      const size = (v.options ?? []).find((o) => /^size$/i.test(o.name))
        ?.value.trim()
      const color = (v.options ?? []).find((o) => /^colou?r$/i.test(o.name))
        ?.value.trim()
      if (size && !/^(default(?: title)?)$/i.test(size)) {
        const key = size.toLowerCase()
        if (!seenSize.has(key)) {
          seenSize.add(key)
          sizes.push(size)
        }
      }
      if (color && !/^(default(?: title)?)$/i.test(color)) {
        const key = color.toLowerCase()
        if (!seenColor.has(key)) {
          seenColor.add(key)
          colors.push(color)
        }
      }
    }
    return {
      title: p.title,
      imageUrl: p.imageUrl ?? null,
      productUrl: p.productUrl ?? '',
      cartUrl: p.cartUrl ?? null,
      checkoutUrl: p.checkoutUrl ?? null,
      inStock,
      retailerId: null,
      caption: [
        p.title,
        price,
        inStock ? 'Stock in' : 'Stock out',
        sizes.length > 0 ? `Variants: ${sizes.join(', ')}` : '',
        colors.length > 0 ? `Color: ${colors.join(', ')}` : '',
        p.productUrl ? `View: ${p.productUrl}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  })
  h.buildConversationContext.mockResolvedValue([{ role: 'user', content: 'hi' }])
  h.loadContactMemory.mockResolvedValue({
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
    },
    notes: [],
    summarizedThroughAt: null,
    messageCountAtSummary: 0,
    conversationId: null,
  })
  h.persistLanguageLock.mockImplementation(
    async (args: { existing: Record<string, unknown>; lock: { name: string; code: string; script: string } }) => ({
      ...args.existing,
      facts: {
        language: args.lock.name,
        language_code: args.lock.code,
        language_script: args.lock.script,
        language_locked: true,
      },
    }),
  )
  h.formatCustomerMemoryBlock.mockReturnValue('')
  h.emptyContactMemory.mockReturnValue({
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
    },
    notes: [],
    summarizedThroughAt: null,
    messageCountAtSummary: 0,
    conversationId: null,
  })
  h.retrieveKnowledge.mockResolvedValue([])
  h.retrieveShopifyStoreContent.mockResolvedValue([])
  h.generateReply.mockResolvedValue({ text: 'Hello!', handoff: false })
  h.engineSendText.mockResolvedValue({ whatsapp_message_id: 'm1' })
  h.engineSendInteractiveButtons.mockResolvedValue({ whatsapp_message_id: 'm-btn' })
  h.engineSendCtaUrl.mockReset().mockResolvedValue({ whatsapp_message_id: 'm-cta' })
  h.engineSendProduct.mockReset().mockResolvedValue({ whatsapp_message_id: 'm-prod' })
  h.engineSendProductList.mockReset().mockResolvedValue({ whatsapp_message_id: 'm-list' })
  h.engineSendMedia.mockResolvedValue({ whatsapp_message_id: 'm-audio' })
  h.engineSendTypingIndicator.mockResolvedValue(undefined)
  h.synthesizeSpeech.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/ogg',
  })
  h.uploadGeneratedAudio.mockResolvedValue({
    publicUrl: 'https://cdn.example/ai-reply.ogg',
    path: 'account-acct-1/generated/ai-reply.ogg',
    mimeType: 'audio/ogg',
  })
  h.realtimeTurn.mockResolvedValue({
    text: 'Realtime hello',
    handoff: false,
    pcm: new Uint8Array([1, 2, 3]),
    sampleRate: 24000,
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    model: 'gpt-realtime-2.1-mini',
  })
  h.pcm16ToOggOpus.mockResolvedValue({
    bytes: new Uint8Array([9, 9]),
    mimeType: 'audio/ogg',
  })
})

describe('dispatchInboundToAiReply — eligibility gates', () => {
  it('claims a slot and sends on the happy path', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.rpcCalls).toEqual([
      {
        name: 'claim_ai_reply_slot',
        args: { conversation_id: 'conv-1', max_replies: 3 },
      },
    ])
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1', text: 'Hello!' }),
    )
    expect(h.engineSendTypingIndicator).not.toHaveBeenCalled()
  })

  it('skips auto-reply while a live WhatsApp call is in progress', async () => {
    h.state.liveCalls = [{ id: 'call-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('grounds the reply in retrieved knowledge', async () => {
    h.retrieveKnowledge.mockResolvedValue(['Returns accepted within 30 days.'])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveKnowledge).toHaveBeenCalled()
    expect(h.retrieveShopifyStoreContent).not.toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
  })

  it('grounds the reply in Shopify store pages and policies', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 't',
      isActive: true,
    })
    h.retrieveShopifyStoreContent.mockResolvedValue([
      'Policy: Refund Policy\nReturns accepted within 30 days.',
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.retrieveShopifyStoreContent).toHaveBeenCalled()
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toContain('Returns accepted within 30 days.')
    expect(systemPrompt).toMatch(/search_store_info/i)
    expect(systemPrompt).toMatch(/delivery time/i)
    expect(systemPrompt).not.toMatch(/tools failed/i)
    expect(systemPrompt).not.toMatch(/This is their first message/)
  })

  it('welcomes the WhatsApp first name on the first Shopify inbound', async () => {
    h.state.contactName = 'Anil Kumar'
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 't',
      isActive: true,
      shopName: 'Aurimo',
    })
    await dispatchInboundToAiReply({ ...ARGS, isFirstInbound: true })
    const systemPrompt = h.generateReply.mock.calls[0][0].systemPrompt as string
    expect(systemPrompt).toMatch(/first name is Anil/)
    expect(systemPrompt).toMatch(/This is their first message/)
    expect(systemPrompt).toMatch(/MUST open with a short welcome using their first name Anil/)
    expect(systemPrompt).toMatch(/Welcome them to Aurimo/)
  })

  it('stands down when an active message-level automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('does not send when the atomic slot claim loses the race', async () => {
    h.state.claim = false
    await dispatchInboundToAiReply(ARGS)
    // It still attempts the claim, but the send is skipped.
    expect(h.state.rpcCalls).toHaveLength(1)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when AI is off / not configured', async () => {
    h.loadAiConfig.mockResolvedValue(null)
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply is disabled for the account', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyEnabled: false }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when a human agent is assigned', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('skips when auto-reply was disabled on this conversation', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('still replies when auto-reply was disabled but full-agent mode is on', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: true,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendInteractiveButtons).toHaveBeenCalled()
  })

  it('skips when the per-conversation cap is reached', async () => {
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 3,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.engineSendInteractiveButtons).not.toHaveBeenCalled()
  })

  it('does not skip when unlimited and the count is high', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ autoReplyUnlimited: true }))
    h.state.conv = {
      assigned_agent_id: null,
      ai_autoreply_disabled: false,
      ai_reply_count: 50,
    }
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.state.rpcCalls[0]).toMatchObject({
      name: 'claim_ai_reply_slot',
      args: { max_replies: null },
    })
  })

  it('injects stored chat memory into the system prompt', async () => {
    h.formatCustomerMemoryBlock.mockReturnValue(
      'Profile: Wants a red saree, size M',
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.loadContactMemory).toHaveBeenCalled()
    const prompt = h.generateReply.mock.calls[0]?.[0]?.systemPrompt as string
    expect(prompt).toMatch(/Wants a red saree, size M/)
    expect(prompt).toMatch(/Do not re-ask/)
    expect(prompt).toMatch(/Do not recite this dump/)
  })

  it('locks Malayalam and keeps it when the next turn is English product text', async () => {
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'ethra und alle' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.persistLanguageLock).toHaveBeenCalledWith(
      expect.objectContaining({
        lock: expect.objectContaining({ code: 'ml' }),
      }),
    )
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toMatch(
      /Locked reply language: Malayalam/,
    )
    expect(h.generateReply.mock.calls[0][0].replyLanguage).toMatchObject({
      code: 'ml',
    })

    h.persistLanguageLock.mockClear()
    h.generateReply.mockClear()
    h.loadContactMemory.mockResolvedValue({
      profileSummary: '',
      lastSessionSummary: '',
      facts: {
        intent: null,
        products: [],
        preferences: [],
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'romanized',
        language_locked: true,
        open_questions: [],
      },
      notes: [],
      summarizedThroughAt: null,
      messageCountAtSummary: 1,
      conversationId: 'conv-1',
    })
    h.buildConversationContext.mockResolvedValue([
      { role: 'user', content: 'Do you have this dress in red?' },
    ])
    await dispatchInboundToAiReply(ARGS)
    expect(h.persistLanguageLock).not.toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].replyLanguage).toMatchObject({
      code: 'ml',
    })
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toMatch(
      /Locked reply language: Malayalam/,
    )
  })

  it('skips when there is nothing to reply to', async () => {
    h.buildConversationContext.mockResolvedValue([])
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — handoff', () => {
  it('disables auto-reply, writes a summary, and does not send on handoff', async () => {
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendText).not.toHaveBeenCalled()
    expect(h.state.rpcCalls).toHaveLength(0)
    expect(h.state.updatePayload).toMatchObject({ ai_autoreply_disabled: true })
    expect(h.state.updatePayload?.ai_handoff_summary).toContain(
      'AI agent handed off',
    )
    // No handoff target configured → conversation left unassigned.
    expect(h.state.updatePayload).not.toHaveProperty('assigned_agent_id')
  })

  it('retries without the handoff protocol when full-agent mode is on', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.generateReply
      .mockResolvedValueOnce({ text: '', handoff: true })
      .mockResolvedValueOnce({ text: 'I can help with that.', handoff: false })
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalledTimes(2)
    expect(h.generateReply.mock.calls[1]?.[0].systemPrompt).not.toContain(
      '[[HANDOFF]]',
    )
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: 'I can help with that.' }),
    )
  })

  it('sends a fallback line when full-agent retries still hand off', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: FULL_AGENT_FALLBACK_REPLY }),
    )
  })

  it('routes to the configured handoff agent on handoff', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ handoffAgentId: 'agent-7' }))
    h.generateReply.mockResolvedValue({ text: '', handoff: true })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toMatchObject({
      ai_autoreply_disabled: true,
      assigned_agent_id: 'agent-7',
    })
  })
})

describe('dispatchInboundToAiReply — voice modality', () => {
  it('sends a voice note for inbound audio when mode is same', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test' }),
    )
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'audio' })
    expect(h.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hello!',
        whatsapp: true,
      }),
    )
    expect(h.uploadGeneratedAudio).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        mimeType: 'audio/ogg',
        fileName: 'ai-reply.ogg',
      }),
    )
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audio',
        link: 'https://cdn.example/ai-reply.ogg',
        contentText: 'Hello!',
        aiGenerated: true,
        voice: true,
      }),
    )
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('falls back to text when TTS fails on a voice note', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'audio' }),
    )
    h.synthesizeSpeech.mockRejectedValue(new Error('tts down'))
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'audio' })
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('sends text and a voice note when mode is both', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'both' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ voice: true }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('sends text only when mode is text even if TTS is configured', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'text' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('sends text for a voice note when mode is text', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'text' }),
    )
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'audio' })
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('does not speak website links in the voice note', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'both' }),
    )
    h.generateReply.mockResolvedValue({
      text: 'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
      handoff: false,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'This looks like our Red Bag.',
        whatsapp: true,
      }),
    )
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        voice: true,
        contentText:
          'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
      }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
      }),
    )
  })

  it('skips TTS and sends text when the reply is only a URL', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'audio' }),
    )
    h.generateReply.mockResolvedValue({
      text: 'https://shop.example/products/red-bag',
      handoff: false,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'https://shop.example/products/red-bag',
      }),
    )
  })

  it('sends a voice note only when mode is audio', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'audio' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ voice: true }),
    )
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('sends text only when mode is same and inbound is text', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ elevenlabsApiKey: 'xi-test', voiceReplyMode: 'same' }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('falls back to text when audio is requested but no speech key is set', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ voiceReplyMode: 'audio' }))
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'audio' })
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('still speaks on a voice note when a text automation exists', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    h.loadAiConfig.mockResolvedValue(aiConfig({ elevenlabsApiKey: 'xi-test' }))
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'audio' })
    expect(h.engineSendMedia).toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('ignores text automations when full-agent mode is on', async () => {
    h.state.autoResponders = [{ id: 'auto-1' }]
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendInteractiveButtons).toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — typing indicator', () => {
  it('shows typing before generate when enabled and a Meta id is present', async () => {
    await dispatchInboundToAiReply({
      ...ARGS,
      inboundMetaMessageId: 'wamid.inbound',
    })
    expect(h.engineSendTypingIndicator).toHaveBeenCalledWith({
      accountId: 'acct-1',
      inboundMessageId: 'wamid.inbound',
    })
    expect(h.engineSendTypingIndicator.mock.invocationCallOrder[0]).toBeLessThan(
      h.generateReply.mock.invocationCallOrder[0],
    )
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips typing when the toggle is off', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({ typingIndicatorEnabled: false }),
    )
    await dispatchInboundToAiReply({
      ...ARGS,
      inboundMetaMessageId: 'wamid.inbound',
    })
    expect(h.engineSendTypingIndicator).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('skips typing when no inbound Meta id is provided', async () => {
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendTypingIndicator).not.toHaveBeenCalled()
  })

  it('does not show typing when a human owns the thread', async () => {
    h.state.conv = {
      assigned_agent_id: 'agent-9',
      ai_autoreply_disabled: false,
      ai_reply_count: 0,
    }
    await dispatchInboundToAiReply({
      ...ARGS,
      inboundMetaMessageId: 'wamid.inbound',
    })
    expect(h.engineSendTypingIndicator).not.toHaveBeenCalled()
    expect(h.generateReply).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — OpenAI Realtime voice', () => {
  it('sends a native voice note via Realtime without calling generateReply', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        realtimeVoice: 'alloy',
        ttsEnabled: true,
        voiceReplyMode: 'audio',
      }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.realtimeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        voice: 'alloy',
      }),
    )
    expect(h.pcm16ToOggOpus).toHaveBeenCalled()
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audio',
        voice: true,
        contentText: 'Realtime hello',
        aiGenerated: true,
      }),
    )
    expect(h.generateReply).not.toHaveBeenCalled()
    expect(h.synthesizeSpeech).not.toHaveBeenCalled()
    expect(h.engineSendText).not.toHaveBeenCalled()
  })

  it('falls back to ElevenLabs TTS when Realtime fails', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        ttsEnabled: true,
        elevenlabsApiKey: 'xi-test',
        voiceReplyMode: 'audio',
      }),
    )
    h.realtimeTurn.mockRejectedValue(new Error('socket down'))
    await dispatchInboundToAiReply(ARGS)
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.synthesizeSpeech).toHaveBeenCalled()
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ voice: true }),
    )
  })

  it('does not pause the thread on Realtime handoff when full-agent is on', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        fullAgentEnabled: true,
        ttsEnabled: true,
        voiceReplyMode: 'audio',
      }),
    )
    h.realtimeTurn.mockResolvedValue({
      text: '',
      handoff: true,
      pcm: new Uint8Array(),
      sampleRate: 24000,
      usage: null,
      model: 'gpt-realtime-2.1-mini',
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.state.updatePayload).toBeNull()
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
  })

  it('skips Realtime when mode is same and inbound is text', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        realtimeVoice: 'alloy',
        ttsEnabled: true,
        voiceReplyMode: 'same',
      }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.realtimeTurn).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Hello!' }),
    )
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('sends Realtime audio and text when mode is both', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        realtimeVoice: 'alloy',
        ttsEnabled: true,
        voiceReplyMode: 'both',
      }),
    )
    await dispatchInboundToAiReply(ARGS)
    expect(h.realtimeTurn).toHaveBeenCalled()
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({ voice: true, contentText: 'Realtime hello' }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Realtime hello' }),
    )
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('skips Realtime and passes Shopify tools when the store is connected', async () => {
    h.loadAiConfig.mockResolvedValue(
      aiConfig({
        realtimeVoiceEnabled: true,
        ttsEnabled: true,
        voiceReplyMode: 'audio',
      }),
    )
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      isActive: true,
      shopName: 'Acme',
      primaryDomain: 'https://shop.example',
      currency: 'USD',
      metaCatalogId: null,
      lastVerifiedAt: null,
      lastCatalogSyncAt: null,
      catalogProductCount: 0,
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.realtimeTurn).not.toHaveBeenCalled()
    expect(h.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: 'search_products' }),
        ]),
      }),
    )
    expect(h.engineSendText).toHaveBeenCalled()
  })

  it('sends a product image when Shopify tools return a card', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      isActive: true,
      shopName: 'Acme',
      primaryDomain: 'https://shop.example',
      currency: 'USD',
      metaCatalogId: null,
      lastVerifiedAt: null,
      lastCatalogSyncAt: null,
      catalogProductCount: 2,
    })
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({ products: [] }),
      cards: [
        {
          title: 'Red Bag',
          imageUrl: 'https://cdn.example/bag.jpg',
          productUrl: 'https://shop.example/products/red-bag',
          cartUrl: 'https://shop.example/cart/99:1',
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
          inStock: true,
          caption:
            'Red Bag\n49 USD\nStock in\nView: https://shop.example/products/red-bag',
        },
      ],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) {
        await args.executeTool('match_product_from_photo', {
          description: 'red leather bag',
        })
      }
      return {
        text: 'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
        handoff: false,
      }
    })
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })
    expect(
      h.engineSendMedia.mock.calls.filter((c) => c[0].kind === 'image'),
    ).toHaveLength(0)
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining(
          'https://shop.example/cart/99:1?checkout',
        ),
      }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        displayText: 'Checkout NOW',
        url: 'https://shop.example/cart/99:1?checkout',
        headerImageUrl: 'https://cdn.example/bag.jpg',
        bodyText:
          'Red Bag\n49 USD\nStock in\nView: https://shop.example/products/red-bag',
      }),
    )
  })

  it('sends Checkout after each in-stock product image', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      isActive: true,
      shopName: 'Acme',
      primaryDomain: 'https://shop.example',
      currency: 'USD',
      metaCatalogId: null,
      lastVerifiedAt: null,
      lastCatalogSyncAt: null,
      catalogProductCount: 2,
    })
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({ products: [] }),
      cards: [
        {
          title: 'Red Bag',
          imageUrl: 'https://cdn.example/bag.jpg',
          productUrl: 'https://shop.example/products/red-bag',
          cartUrl: null,
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
          inStock: true,
          caption:
            'Red Bag\n49 USD\nStock in\nView: https://shop.example/products/red-bag',
        },
        {
          title: 'Blue Hat',
          imageUrl: 'https://cdn.example/hat.jpg',
          productUrl: 'https://shop.example/products/blue-hat',
          cartUrl: null,
          checkoutUrl: 'https://shop.example/cart/88:1?checkout',
          inStock: true,
          caption:
            'Blue Hat\n19 USD\nStock in\nView: https://shop.example/products/blue-hat',
        },
      ],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) {
        await args.executeTool('search_products', { query: 'bag hat' })
      }
      return {
        text: 'Here: https://shop.example/cart/99:1?checkout and https://shop.example/cart/88:1?checkout',
        handoff: false,
      }
    })
    await dispatchInboundToAiReply(ARGS)

    expect(
      h.engineSendMedia.mock.calls.filter((c) => c[0].kind === 'image'),
    ).toHaveLength(0)
    expect(h.engineSendCtaUrl).toHaveBeenCalledTimes(2)
    expect(h.engineSendCtaUrl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: 'https://shop.example/cart/99:1?checkout',
        headerImageUrl: 'https://cdn.example/bag.jpg',
        bodyText:
          'Red Bag\n49 USD\nStock in\nView: https://shop.example/products/red-bag',
      }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: 'https://shop.example/cart/88:1?checkout',
        headerImageUrl: 'https://cdn.example/hat.jpg',
        bodyText:
          'Blue Hat\n19 USD\nStock in\nView: https://shop.example/products/blue-hat',
      }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining(
          'https://shop.example/cart/99:1?checkout',
        ),
      }),
    )
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining(
          'https://shop.example/cart/88:1?checkout',
        ),
      }),
    )
  })

  it('sends the photo without Checkout when the item is out of stock', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      isActive: true,
      shopName: 'Acme',
      primaryDomain: 'https://shop.example',
      currency: 'USD',
      metaCatalogId: null,
      lastVerifiedAt: null,
      lastCatalogSyncAt: null,
      catalogProductCount: 2,
    })
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({ products: [] }),
      cards: [
        {
          title: 'Red Bag',
          imageUrl: 'https://cdn.example/bag.jpg',
          productUrl: 'https://shop.example/products/red-bag',
          cartUrl: null,
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
          inStock: false,
          caption:
            'Red Bag\n49 USD\nStock out\nView: https://shop.example/products/red-bag',
        },
      ],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) {
        await args.executeTool('search_products', { query: 'red bag' })
      }
      return {
        text: 'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
        handoff: false,
      }
    })
    await dispatchInboundToAiReply(ARGS)
    expect(h.engineSendMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'image',
        link: 'https://cdn.example/bag.jpg',
        caption: expect.stringContaining('Stock out'),
      }),
    )
    expect(h.engineSendCtaUrl).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.not.stringContaining(
          'https://shop.example/cart/99:1?checkout',
        ),
      }),
    )
  })

  it('does not invent a SKU when the photo does not match', async () => {
    h.loadShopifyConfig.mockResolvedValue({
      accountId: 'acct-1',
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      isActive: true,
      shopName: 'Acme',
      primaryDomain: 'https://shop.example',
      currency: 'USD',
      metaCatalogId: null,
      lastVerifiedAt: null,
      lastCatalogSyncAt: null,
      catalogProductCount: 2,
    })
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({
        products: [],
        note: 'No matching products in the Shopify catalog. Do not invent items.',
      }),
      cards: [],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) {
        await args.executeTool('match_product_from_photo', {
          description: 'blurry unknown object',
        })
      }
      return {
        text: 'I could not find that product. Send a closer photo or the product name.',
        handoff: false,
      }
    })
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })
    expect(h.engineSendMedia).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(/could not find/i),
      }),
    )
    expect(h.engineSendText.mock.calls[0][0].text).not.toMatch(/BAG-RED|SKU-|#1001/)
    expect(h.engineSendCtaUrl).not.toHaveBeenCalled()
  })
})

describe('dispatchInboundToAiReply — vision photo match', () => {
  const shopifyRow = {
    accountId: 'acct-1',
    shopDomain: 'acme.myshopify.com',
    accessToken: 'shpat_test',
    isActive: true,
    shopName: 'Acme',
    primaryDomain: 'https://shop.example',
    currency: 'USD',
    metaCatalogId: null,
    lastVerifiedAt: null,
    lastCatalogSyncAt: null,
    catalogProductCount: 2,
  }

  it('matches catalog and sends product cards without the LLM calling a tool', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.matchProductsFromPhoto.mockResolvedValue([
      {
        id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        description: 'Leather tote',
        imageUrl: 'https://cdn.example/bag.jpg',
        productUrl: 'https://shop.example/products/red-bag',
        cartUrl: 'https://shop.example/cart/99:1',
        checkoutUrl: 'https://shop.example/cart/99:1?checkout',
        priceMin: '49',
        priceMax: '49',
        currency: 'USD',
        variants: [
          {
            id: 'gid://shopify/ProductVariant/9',
            variantId: '99',
            title: 'Small',
            sku: 'BAG-S',
            price: '49',
            compareAtPrice: null,
            available: true,
            options: [
              { name: 'Color', value: 'Red' },
              { name: 'Size', value: 'S' },
            ],
          },
          {
            id: 'gid://shopify/ProductVariant/10',
            variantId: '100',
            title: 'Large',
            sku: 'BAG-L',
            price: '49',
            compareAtPrice: null,
            available: false,
            options: [
              { name: 'Color', value: 'Blue' },
              { name: 'Size', value: 'L' },
            ],
          },
        ],
      },
    ])
    h.generateReply.mockResolvedValue({
      text: 'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
      handoff: false,
    })

    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })

    expect(h.matchProductsFromPhoto).toHaveBeenCalled()
    expect(h.executeShopifyTool).not.toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toMatch(
      /Vision already matched this photo/,
    )
    expect(
      h.engineSendMedia.mock.calls.filter((c) => c[0].kind === 'image'),
    ).toHaveLength(0)
    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: expect.not.stringContaining(
          'https://shop.example/cart/99:1?checkout',
        ),
      }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        displayText: 'Checkout NOW',
        url: 'https://shop.example/cart/99:1?checkout',
        headerImageUrl: 'https://cdn.example/bag.jpg',
        bodyText: expect.stringMatching(
          /Red Bag[\s\S]*Stock in[\s\S]*Variants: S[\s\S]*Color: Red[\s\S]*View:/,
        ),
      }),
    )
  })

  it('does not skip photo matching when the LLM would not call a tool', async () => {
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.matchProductsFromPhoto.mockResolvedValue([])
    h.generateReply.mockResolvedValue({
      text: 'I could not find that product. Send a closer photo.',
      handoff: false,
    })
    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })
    expect(h.matchProductsFromPhoto).toHaveBeenCalled()
    expect(h.generateReply.mock.calls[0][0].systemPrompt).toMatch(/found no matching products/)
    expect(h.engineSendMedia).not.toHaveBeenCalled()
  })

  it('does not send extra search_products cards on an image turn', async () => {
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.matchProductsFromPhoto.mockResolvedValue([
      {
        id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        description: 'Leather tote',
        imageUrl: 'https://cdn.example/bag.jpg',
        productUrl: 'https://shop.example/products/red-bag',
        cartUrl: null,
        checkoutUrl: 'https://shop.example/cart/99:1?checkout',
        priceMin: '49',
        priceMax: '49',
        currency: 'USD',
        variants: [],
      },
    ])
    h.executeShopifyTool.mockResolvedValue({
      json: '{}',
      cards: [
        {
          title: 'Unrelated Mug',
          imageUrl: 'https://cdn.example/mug.jpg',
          productUrl: 'https://shop.example/products/mug',
          cartUrl: null,
          checkoutUrl: null,
          inStock: false,
          caption: 'Unrelated Mug\nStock out',
        },
      ],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) {
        await args.executeTool('search_products', { query: 'new arrivals' })
      }
      return { text: 'This looks like our Red Bag.', handoff: false }
    })

    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })

    const imageSends = h.engineSendMedia.mock.calls.filter(
      (c) => c[0].kind === 'image',
    )
    expect(imageSends).toHaveLength(0)
    expect(h.engineSendCtaUrl).toHaveBeenCalledTimes(1)
    expect(h.engineSendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        headerImageUrl: 'https://cdn.example/bag.jpg',
      }),
    )
  })

  it('live-fetches a catalog image when the snapshot hit has none', async () => {
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.matchProductsFromPhoto.mockResolvedValue([
      {
        id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        description: 'Leather tote',
        imageUrl: null,
        productUrl: 'https://shop.example/products/red-bag',
        cartUrl: null,
        checkoutUrl: 'https://shop.example/cart/99:1?checkout',
        priceMin: '49',
        priceMax: '49',
        currency: 'USD',
        variants: [],
      },
    ])
    h.getProductLive.mockResolvedValue({
      id: 'gid://shopify/Product/1',
      handle: 'red-bag',
      title: 'Red Bag',
      description: 'Leather tote',
      imageUrl: 'https://cdn.example/live-bag.jpg',
      productUrl: 'https://shop.example/products/red-bag',
      cartUrl: null,
      checkoutUrl: null,
      priceMin: '49',
      priceMax: '49',
      currency: 'USD',
      variants: [],
    })
    h.generateReply.mockResolvedValue({
      text: 'This looks like our Red Bag.',
      handoff: false,
    })

    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })

    expect(h.getProductLive).toHaveBeenCalledWith(shopifyRow, 'gid://shopify/Product/1')
    expect(h.engineSendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        headerImageUrl: 'https://cdn.example/live-bag.jpg',
        displayText: 'Checkout NOW',
      }),
    )
  })

  it('rehosts the catalog image when Meta rejects the CDN link', async () => {
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.matchProductsFromPhoto.mockResolvedValue([
      {
        id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        description: 'Leather tote',
        imageUrl: 'https://cdn.shopify.com/bag.jpg',
        productUrl: 'https://shop.example/products/red-bag',
        cartUrl: null,
        checkoutUrl: null,
        priceMin: '49',
        priceMax: '49',
        currency: 'USD',
        variants: [],
      },
    ])
    h.engineSendMedia
      .mockRejectedValueOnce(new Error('Meta could not fetch image'))
      .mockResolvedValue({ whatsapp_message_id: 'm-hosted' })
    h.rehostPublicImage.mockResolvedValue('https://cdn.example/hosted-bag.jpg')
    h.generateReply.mockResolvedValue({
      text: 'This looks like our Red Bag.',
      handoff: false,
    })

    await dispatchInboundToAiReply({ ...ARGS, inboundContentType: 'image' })

    expect(h.rehostPublicImage).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: 'https://cdn.shopify.com/bag.jpg',
      }),
    )
    expect(h.engineSendMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'image',
        link: 'https://cdn.example/hosted-bag.jpg',
      }),
    )
  })

  it('passes the inbound photo into catalog matching', async () => {
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    await dispatchInboundToAiReply({
      ...ARGS,
      inboundContentType: 'image',
      inboundMediaUrl: 'https://cdn.example/customer.jpg',
      inboundMediaId: 'media-1',
      inboundAccessToken: 'wa-token',
    })
    expect(h.matchProductsFromPhoto).toHaveBeenCalledWith(
      expect.anything(),
      shopifyRow,
      'hi',
      expect.objectContaining({
        customerImageUrl: 'https://cdn.example/customer.jpg',
        customerMediaId: 'media-1',
        accessToken: 'wa-token',
        apiKey: 'sk-test',
      }),
    )
  })
})

describe('dispatchInboundToAiReply — cart offer', () => {
  const shopifyRow = {
    accountId: 'acct-1',
    shopDomain: 'acme.myshopify.com',
    accessToken: 'shpat_test',
    isActive: true,
    shopName: 'Acme',
    primaryDomain: 'https://shop.example',
    currency: 'USD',
    metaCatalogId: null,
    lastVerifiedAt: null,
    lastCatalogSyncAt: null,
    catalogProductCount: 2,
  }

  const offer = {
    items: [
      {
        variantId: '99',
        quantity: 1,
        title: 'Red Bag',
        price: '49 USD',
        imageUrl: 'https://cdn.example/bag.jpg',
      },
    ],
    cartUrl: 'https://shop.example/cart/99:1',
    checkoutUrl: 'https://shop.example/cart/99:1?checkout',
    summaryLines: ['Red Bag — 49 USD'],
  }

  it('sends summary buttons plus View cart and one aggregated Checkout NOW', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({
        items: offer.items,
        cart_url: offer.cartUrl,
        checkout_url: offer.checkoutUrl,
      }),
      cards: [],
      cartOffer: offer,
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) await args.executeTool('offer_cart', {})
      return {
        text: 'You asked for the red bag. Here is your cart.',
        handoff: false,
      }
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: 'You asked for the red bag. Here is your cart.',
        buttons: [
          { id: 'wacrm:confirm_order', title: 'Confirm order' },
          { id: 'wacrm:more_options', title: 'Check other options' },
        ],
      }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenCalledTimes(2)
    expect(h.engineSendCtaUrl).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        displayText: 'View cart',
        url: 'https://shop.example/cart/99:1',
      }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        displayText: 'Checkout NOW',
        url: 'https://shop.example/cart/99:1?checkout',
      }),
    )
    expect(
      h.engineSendCtaUrl.mock.calls.some(
        (c) =>
          c[0].displayText === 'Checkout NOW' &&
          c[0].url === 'https://shop.example/cart/99:1?checkout' &&
          c[0].headerImageUrl === 'https://cdn.example/bag.jpg',
      ),
    ).toBe(true)
  })

  it('sends cart CTAs on Confirm order without a tool call', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.buildConversationContext.mockResolvedValue([
      {
        role: 'user',
        content:
          '[Customer tapped "Confirm order" (action: wacrm:confirm_order)]',
      },
    ])
    h.resolveCartOfferItems.mockResolvedValue(offer.items)
    h.buildCartOffer.mockReturnValue(offer)
    h.generateReply.mockResolvedValue({
      text: 'Confirming your red bag.',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.resolveCartOfferItems).toHaveBeenCalled()
    expect(h.engineSendInteractiveButtons).not.toHaveBeenCalled()
    expect(h.engineSendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Confirming your red bag.' }),
    )
    expect(h.engineSendCtaUrl).toHaveBeenCalledTimes(2)
    expect(h.engineSendCtaUrl.mock.calls.map((c) => c[0].displayText)).toEqual([
      'View cart',
      'Checkout NOW',
    ])
  })

  it('does not send the cart bundle on Check other options', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.buildConversationContext.mockResolvedValue([
      {
        role: 'user',
        content:
          '[Customer tapped "Check other options" (action: wacrm:more_options)]',
      },
    ])
    h.executeShopifyTool.mockResolvedValue({
      json: JSON.stringify({ products: [] }),
      cards: [
        {
          title: 'Blue Bag',
          imageUrl: 'https://cdn.example/blue.jpg',
          productUrl: 'https://shop.example/products/blue-bag',
          cartUrl: 'https://shop.example/cart/77:1',
          checkoutUrl: 'https://shop.example/cart/77:1?checkout',
          inStock: true,
          caption: 'Blue Bag\n39 USD\nStock in',
        },
      ],
      cartOffer: offer,
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) await args.executeTool('search_products', { query: 'bag' })
      return { text: 'Here are other bags.', handoff: false }
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: expect.arrayContaining([
          expect.objectContaining({ id: 'wacrm:products' }),
        ]),
      }),
    )
    expect(
      h.engineSendCtaUrl.mock.calls.some((c) => c[0].displayText === 'View cart'),
    ).toBe(false)
    expect(h.engineSendCtaUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        displayText: 'Checkout NOW',
        url: 'https://shop.example/cart/77:1?checkout',
      }),
    )
  })

  it('does not send CTAs when last-shown is empty', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue(shopifyRow)
    h.buildConversationContext.mockResolvedValue([
      {
        role: 'user',
        content:
          '[Customer tapped "Confirm order" (action: wacrm:confirm_order)]',
      },
    ])
    h.resolveCartOfferItems.mockResolvedValue([])
    h.buildCartOffer.mockReturnValue(null)
    h.generateReply.mockResolvedValue({
      text: 'Tell me which product you want first.',
      handoff: false,
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendCtaUrl).not.toHaveBeenCalled()
    expect(h.engineSendInteractiveButtons).toHaveBeenCalledWith(
      expect.objectContaining({
        bodyText: 'Tell me which product you want first.',
      }),
    )
  })

  it('sends native catalog cards instead of checkout CTAs when catalog id is set', async () => {
    h.loadAiConfig.mockResolvedValue(aiConfig({ fullAgentEnabled: true }))
    h.loadShopifyConfig.mockResolvedValue({
      ...shopifyRow,
      metaCatalogId: '1234567890',
    })
    h.loadCommerceSettings.mockResolvedValue({
      metaCatalogId: '1234567890',
      metaCatalogAutoSync: true,
      lastMetaCatalogSyncAt: null,
      metaCatalogItemCount: 1,
      retailerIdSource: 'sku',
      waPaymentConfigurationName: 'razorpay_prod',
      razorpayKeyId: null,
      hasRazorpaySecret: false,
      hasRazorpayWebhookSecret: false,
      shipBeneficiary: null,
    })
    h.executeShopifyTool.mockResolvedValue({
      json: '{}',
      cards: [
        {
          title: 'Red Bag',
          imageUrl: 'https://cdn.example/bag.jpg',
          productUrl: 'https://shop.example/products/red-bag',
          cartUrl: 'https://shop.example/cart/99:1',
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
          inStock: true,
          caption: 'Red Bag',
          retailerId: 'BAG-RED',
        },
      ],
    })
    h.generateReply.mockImplementation(async (args: { executeTool?: Function }) => {
      if (args.executeTool) await args.executeTool('search_products', { query: 'bag' })
      return { text: 'Here is the bag.', handoff: false }
    })

    await dispatchInboundToAiReply(ARGS)

    expect(h.engineSendProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogId: '1234567890',
        productRetailerId: 'BAG-RED',
      }),
    )
    expect(h.engineSendCtaUrl).not.toHaveBeenCalled()
  })
})

