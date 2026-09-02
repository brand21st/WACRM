import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, FULL_AGENT_FALLBACK_REPLY } from './defaults'
import { speakableFirstName } from './customer-name'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, engineSendMedia, engineSendTypingIndicator, engineSendInteractiveButtons, engineSendCtaUrl } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveReplyChannels, type InboundModality } from './voice'
import { canSpeak as ttsReady, synthesizeSpeech } from './speech'
import { prepareIndicSpeechText, stripUrlsForSpeech } from './speech-text'
import {
  CHECKOUT_BUTTON_LABEL,
  cardHasCheckout,
  ctaBodyFromCard,
  stripCheckoutUrlsFromReply,
} from './checkout-cta'
import { detectSpokenIndicTarget } from './indic-language'
import { uploadGeneratedAudio } from '@/lib/elevenlabs/storage'
import { realtimeTurn } from './realtime'
import { pcm16ToOggOpus } from '@/lib/audio/pcm-to-opus'
import {
  loadShopifyConfig,
  SHOPIFY_LLM_TOOLS,
  executeShopifyTool,
  retrieveShopifyStoreContent,
  matchProductsFromPhoto,
  toCard,
  getProductLive,
} from '@/lib/shopify'
import type { ShopifyProductCard, ShopifyStoreConfig } from '@/lib/shopify'
import { rehostPublicImage } from '@/lib/storage/generated-media'
import type { ExecuteLlmTool, LlmToolDef } from './providers/shared'
import type { AiConfig, ChatMessage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'
import { buildAiChatButtons, WACRM_CHAT_BUTTON_IDS } from './chat-buttons'

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string
  conversationId: string
  contactId: string
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string
  /** Inbound modality after STT. Voice notes that produced a transcript
   *  still count as `audio` so `voice_reply_mode=same` speaks back. */
  inboundContentType?: InboundModality
  /** Meta `messages.id` from the inbound webhook. Used to show WhatsApp
   *  typing before the reply is generated. */
  inboundMetaMessageId?: string
  /** Inbound image URL (mirrored or Meta CDN) for catalog photo confirm. */
  inboundMediaUrl?: string | null
  /** Meta media id when the URL is not a public HTTPS link. */
  inboundMediaId?: string | null
  /** WhatsApp Cloud API token for downloading inbound media. */
  inboundAccessToken?: string | null
  /** True when this is the contact's first customer-sent message in the thread. */
  isFirstInbound?: boolean
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs,
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    inboundContentType = 'text',
    inboundMetaMessageId,
    inboundMediaUrl,
    inboundMediaId,
    inboundAccessToken,
    isFirstInbound = false,
  } = args

  try {
    const db = supabaseAdmin()

    const config = await loadAiConfig(db, accountId)
    if (!config || !config.autoReplyEnabled) return

    // Deterministic, user-configured responders win over the LLM for
    // typed messages — unless full-agent mode is on. Voice notes and
    // images skip that stand-down: they are the agent's job.
    if (!config.fullAgentEnabled && inboundContentType === 'text') {
      const { data: autoResponders } = await db
        .from('automations')
        .select('id')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .in('trigger_type', ['new_message_received', 'keyword_match'])
        .limit(1)
      if (autoResponders && autoResponders.length > 0) return
    }

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled && !config.fullAgentEnabled) return
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (
      !config.autoReplyUnlimited &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    )
      return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) return

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads.
    // Going over the budget logs a warning but still replies — dropping
    // the turn was how overlapping voice notes never got an answer.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount,
    )
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} is above the per-account budget — still replying so overlapping customers are not dropped.`,
      )
    }

    // Show typing before the slow retrieve/generate/TTS work so the
    // customer sees the WhatsApp animation instead of a silent wait.
    if (config.typingIndicatorEnabled && inboundMetaMessageId) {
      await engineSendTypingIndicator({
        accountId,
        inboundMessageId: inboundMetaMessageId,
      })
    }

    const shopify = await loadShopifyConfig(db, accountId).catch((err) => {
      console.error('[ai auto-reply] loadShopifyConfig failed:', err)
      return null
    })

    const queryText = latestUserMessage(messages)
    const [manualKnowledge, storeContent] = await Promise.all([
      retrieveKnowledge(db, accountId, config, queryText),
      shopify
        ? retrieveShopifyStoreContent(db, accountId, queryText, 5)
        : Promise.resolve([] as string[]),
    ])
    const knowledge = [...storeContent, ...manualKnowledge].slice(0, 8)

    const { data: contactRow } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    const productCards: ShopifyProductCard[] = []
    const imageTurn = inboundContentType === 'image'
    const shopifyTools = bindShopifyTools(
      db,
      shopify,
      contactRow?.phone ?? null,
      productCards,
      { imageTurn },
    )

    let photoMatches: Awaited<ReturnType<typeof matchProductsFromPhoto>> | undefined
    if (imageTurn && shopify) {
      try {
        photoMatches = await matchProductsFromPhoto(
          db,
          shopify,
          latestUserMessage(messages),
          {
            customerImageUrl: inboundMediaUrl,
            customerMediaId: inboundMediaId,
            accessToken: inboundAccessToken,
            apiKey: config.provider === 'openai' ? config.apiKey : null,
          },
        )
        for (const hit of await hydrateCardImages(shopify, photoMatches)) {
          productCards.push(hit)
        }
      } catch (err) {
        console.error('[ai auto-reply] matchProductsFromPhoto failed:', err)
        photoMatches = []
      }
    }

    const customerName = speakableFirstName(contactRow?.name)
    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      shopify: Boolean(shopify),
      photoMatches,
      customerName,
      firstInbound: isFirstInbound,
      shopName: shopify?.shopName,
    })

    const sendArgs = {
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
    }

    const channels = resolveReplyChannels(
      config.voiceReplyMode,
      inboundContentType,
    )
    const wantsAudio = channels.includes('audio')
    const wantsText = channels.includes('text')

    // Realtime has no tool loop — skip it when Shopify catalog/orders
    // must stay accurate. Only enter when the reply mode asked for audio.
    if (
      wantsAudio &&
      config.ttsEnabled &&
      !shopify &&
      shouldUseRealtime(config, accountId)
    ) {
      try {
        const spoken = await realtimeTurn({
          apiKey: config.apiKey,
          systemPrompt,
          messages,
          voice: config.realtimeVoice,
        })
        void logAiUsage(db, {
          accountId,
          conversationId,
          mode: 'auto_reply',
          provider: config.provider,
          model: spoken.model,
          usage: spoken.usage,
        })
        if (spoken.pcm.byteLength > 0 && !spoken.handoff) {
          const encoded = await pcm16ToOggOpus({
            pcm: spoken.pcm,
            sampleRate: spoken.sampleRate,
          })
          if (!(await claimReplySlot(db, conversationId, config))) return
          const stored = await uploadGeneratedAudio({
            accountId,
            bytes: encoded.bytes,
            mimeType: encoded.mimeType,
            fileName: 'ai-reply.ogg',
          })
          await engineSendMedia({
            ...sendArgs,
            kind: 'audio',
            link: stored.publicUrl,
            mediaType: stored.mimeType,
            contentText: spoken.text,
            aiGenerated: true,
            voice: true,
          })
          if (wantsText && spoken.text) {
            const handedOff = await sendCustomerFacingText({
              db,
              config,
              conv,
              conversationId,
              sendArgs,
              text: stripCheckoutUrlsFromReply(
                spoken.text,
                productCards.map((c) => c.checkoutUrl),
              ),
              messages,
              shopify: false,
              wantsText: true,
              wantsAudio: true,
              audioSent: true,
              productCards,
            })
            if (handedOff) return
          }
          await sendProductCards(sendArgs, productCards, shopify)
          return
        }
        if (!config.fullAgentEnabled) {
          await maybeHandoff(db, config, conv, conversationId, messages)
          return
        }
        // Full-agent: skip silent handoff and generate a batch reply.
      } catch (err) {
        console.warn(
          '[ai auto-reply] Realtime voice failed — falling back to batch TTS:',
          err,
        )
      }
    }

    const { text, handoff } = await generateCustomerFacingReply({
      db,
      config,
      accountId,
      conversationId,
      systemPrompt,
      messages,
      knowledge,
      shopify: Boolean(shopify),
      photoMatches,
      customerName,
      firstInbound: isFirstInbound,
      shopName: shopify?.shopName,
      tools: shopifyTools.tools,
      executeTool: shopifyTools.executeTool,
    })

    if (handoff || !text) {
      await maybeHandoff(db, config, conv, conversationId, messages)
      return
    }

    if (!(await claimReplySlot(db, conversationId, config))) return

    const languageHint = detectSpokenIndicTarget(
      latestUserMessage(messages),
    )?.elevenlabs
    const spokenText = prepareIndicSpeechText(
      stripUrlsForSpeech(text),
      languageHint,
    )
    const canSpeak = ttsReady(config) && Boolean(spokenText)

    let audioSent = false
    if (wantsAudio && canSpeak) {
      try {
        const spoken = await synthesizeSpeech({
          config,
          text: spokenText,
          whatsapp: true,
          languageHint,
        })
        const stored = await uploadGeneratedAudio({
          accountId,
          bytes: spoken.bytes,
          mimeType: spoken.mimeType || 'audio/ogg',
          fileName: 'ai-reply.ogg',
        })
        await engineSendMedia({
          ...sendArgs,
          kind: 'audio',
          link: stored.publicUrl,
          mediaType: stored.mimeType,
          contentText: text,
          aiGenerated: true,
          voice: true,
        })
        audioSent = true
      } catch (err) {
        console.error('[ai auto-reply] TTS/audio send failed:', err)
      }
    }

    const textForCustomer = stripCheckoutUrlsFromReply(
      text,
      productCards.map((c) => c.checkoutUrl),
    )

    const handedOff = await sendCustomerFacingText({
      db,
      config,
      conv,
      conversationId,
      sendArgs,
      text: textForCustomer,
      messages,
      shopify: Boolean(shopify),
      wantsText,
      wantsAudio,
      audioSent,
      productCards,
    })
    if (handedOff) return

    await sendProductCards(sendArgs, productCards, shopify)
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err)
  }
}

type SendArgs = {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
}

type ConvRow = {
  assigned_agent_id: string | null
  ai_reply_count: number | null
}

/** Send the text bubble (or full-agent buttons). Returns true when the
 *  last inbound tap asked for a human and the thread was handed off. */
async function sendCustomerFacingText(args: {
  db: SupabaseClient
  config: AiConfig
  conv: ConvRow
  conversationId: string
  sendArgs: SendArgs
  text: string
  messages: ChatMessage[]
  shopify: boolean
  wantsText: boolean
  wantsAudio: boolean
  audioSent: boolean
  productCards: ShopifyProductCard[]
}): Promise<boolean> {
  const chatButtons = args.config.fullAgentEnabled
    ? buildAiChatButtons(args.shopify)
    : []
  const agentTap =
    args.messages.length > 0 &&
    args.messages[args.messages.length - 1]?.content?.includes(
      WACRM_CHAT_BUTTON_IDS.agent,
    )

  if (agentTap) {
    await maybeHandoff(
      args.db,
      args.config,
      args.conv,
      args.conversationId,
      args.messages,
    )
    return true
  }

  const canUseChatButtons =
    args.wantsText &&
    chatButtons.length > 0 &&
    args.text.length <= INTERACTIVE_LIMITS.bodyMaxLength

  if (canUseChatButtons) {
    await engineSendInteractiveButtons({
      ...args.sendArgs,
      bodyText: args.text,
      buttons: chatButtons,
      aiGenerated: true,
    })
    return false
  }

  // Text when the mode asked for it, when audio could not be sent, or
  // when Shopify product links must stay tappable in the thread.
  if (
    args.wantsText ||
    (args.wantsAudio && !args.audioSent) ||
    args.productCards.length > 0
  ) {
    await engineSendText({
      ...args.sendArgs,
      text: args.text,
      aiGenerated: true,
    })
  }
  return false
}

function shouldUseRealtime(config: AiConfig, accountId: string): boolean {
  if (!config.realtimeVoiceEnabled || config.provider !== 'openai') return false
  const limit = checkRateLimit(
    `ai-realtime:${accountId}`,
    RATE_LIMITS.aiRealtimeAccount,
  )
  if (!limit.success) {
    console.warn(
      `[ai auto-reply] account ${accountId} hit the Realtime rate limit — falling back.`,
    )
    return false
  }
  return true
}

async function maybeHandoff(
  db: SupabaseClient,
  config: AiConfig,
  conv: { assigned_agent_id: string | null; ai_reply_count: number | null },
  conversationId: string,
  messages: ChatMessage[],
): Promise<void> {
  // Full-agent mode keeps the bot live — model handoffs must not
  // sticky-pause the thread while the inbox toggle is on.
  if (config.fullAgentEnabled) return

  const summary = buildHandoffSummary({
    messages,
    replyCount: conv.ai_reply_count ?? 0,
  })
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: summary,
  }
  if (config.handoffAgentId && !conv.assigned_agent_id) {
    update.assigned_agent_id = config.handoffAgentId
  }
  await db.from('conversations').update(update).eq('id', conversationId)
}

async function claimReplySlot(
  db: SupabaseClient,
  conversationId: string,
  config: AiConfig,
): Promise<boolean> {
  const { data: claimed, error: claimErr } = await db.rpc(
    'claim_ai_reply_slot',
    {
      conversation_id: conversationId,
      max_replies: config.autoReplyUnlimited
        ? null
        : config.autoReplyMaxPerConversation,
    },
  )
  if (claimErr) {
    console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr)
    return false
  }
  return claimed === true
}

async function generateCustomerFacingReply(args: {
  db: SupabaseClient
  config: AiConfig
  accountId: string
  conversationId: string
  systemPrompt: string
  messages: ChatMessage[]
  knowledge: string[]
  shopify?: boolean
  photoMatches?: Awaited<ReturnType<typeof matchProductsFromPhoto>>
  customerName?: string | null
  firstInbound?: boolean
  shopName?: string | null
  tools?: LlmToolDef[]
  executeTool?: ExecuteLlmTool
}): Promise<{ text: string; handoff: boolean }> {
  const first = await generateReply({
    config: args.config,
    systemPrompt: args.systemPrompt,
    messages: args.messages,
    customerName: args.customerName,
    tools: args.tools,
    executeTool: args.executeTool,
  })
  void logAiUsage(args.db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    mode: 'auto_reply',
    provider: args.config.provider,
    model: args.config.model,
    usage: first.usage,
  })

  if (!first.handoff && first.text) {
    return { text: first.text, handoff: false }
  }

  if (!args.config.fullAgentEnabled) {
    return { text: first.text, handoff: first.handoff || !first.text }
  }

  // Inbox toggle says the bot stays live. Retry without the handoff
  // protocol so the customer always gets a spoken/text reply.
  const retry = await generateReply({
    config: args.config,
    systemPrompt: buildSystemPrompt({
      userPrompt: args.config.systemPrompt,
      mode: 'draft',
      knowledge: args.knowledge,
      shopify: args.shopify,
      photoMatches: args.photoMatches,
      customerName: args.customerName,
      firstInbound: args.firstInbound,
      shopName: args.shopName,
    }),
    messages: args.messages,
    customerName: args.customerName,
    tools: args.tools,
    executeTool: args.executeTool,
  })
  void logAiUsage(args.db, {
    accountId: args.accountId,
    conversationId: args.conversationId,
    mode: 'auto_reply',
    provider: args.config.provider,
    model: args.config.model,
    usage: retry.usage,
  })

  return {
    text: retry.text || first.text || FULL_AGENT_FALLBACK_REPLY,
    handoff: false,
  }
}

function bindShopifyTools(
  db: SupabaseClient,
  shopify: ShopifyStoreConfig | null,
  contactPhone: string | null,
  productCards: ShopifyProductCard[],
  opts: { imageTurn: boolean } = { imageTurn: false },
): { tools?: LlmToolDef[]; executeTool?: ExecuteLlmTool } {
  if (!shopify) return {}
  return {
    tools: SHOPIFY_LLM_TOOLS,
    executeTool: async (name, args) => {
      const result = await executeShopifyTool(
        { db, config: shopify, contactPhone },
        name,
        args,
      )
      const skipCards =
        opts.imageTurn &&
        (name === 'search_products' || name === 'list_new_arrivals')
      if (!skipCards) productCards.push(...result.cards)
      return result.json
    },
  }
}

async function hydrateCardImages(
  shopify: ShopifyStoreConfig,
  hits: Awaited<ReturnType<typeof matchProductsFromPhoto>>,
): Promise<ShopifyProductCard[]> {
  const cards: ShopifyProductCard[] = []
  for (const hit of hits) {
    if (hit.imageUrl) {
      cards.push(toCard(hit))
      continue
    }
    try {
      const live = await getProductLive(shopify, hit.id)
      cards.push(toCard(live?.imageUrl ? { ...hit, imageUrl: live.imageUrl } : hit))
    } catch (err) {
      console.warn('[ai auto-reply] live image fetch failed:', err)
      cards.push(toCard(hit))
    }
  }
  return cards
}

const MAX_PRODUCT_CARDS = 3

async function sendProductCards(
  sendArgs: {
    accountId: string
    userId: string
    conversationId: string
    contactId: string
  },
  cards: ShopifyProductCard[],
  shopify?: ShopifyStoreConfig | null,
): Promise<void> {
  const seen = new Set<string>()
  let sent = 0
  for (const card of cards) {
    if (sent >= MAX_PRODUCT_CARDS) break
    const key = card.productUrl || card.title
    if (!key || seen.has(key)) continue
    seen.add(key)
    let imageUrl = card.imageUrl
    if (!imageUrl && shopify) {
      imageUrl = await liveImageForCard(shopify, card)
    }
    const checkout = cardHasCheckout(card)
    if (imageUrl) {
      const ok = await sendCatalogImage(sendArgs, {
        ...card,
        imageUrl,
        // Photo stays a photo; the Checkout CTA carries the product card.
        caption: checkout ? card.title.slice(0, 1024) : card.caption,
      })
      if (!ok) continue
    } else if (!checkout) {
      if (!card.caption.trim()) continue
      try {
        await engineSendText({
          ...sendArgs,
          text: card.caption,
          aiGenerated: true,
        })
      } catch (err) {
        console.error('[ai auto-reply] product caption send failed:', err)
        continue
      }
    }
    await sendCheckoutCtaIfInStock(sendArgs, card)
    sent += 1
  }
}

async function sendCheckoutCtaIfInStock(
  sendArgs: SendArgs,
  card: ShopifyProductCard,
): Promise<void> {
  const url = card.checkoutUrl?.trim()
  if (!card.inStock || !url) return
  try {
    await engineSendCtaUrl({
      ...sendArgs,
      bodyText: ctaBodyFromCard(card),
      displayText: CHECKOUT_BUTTON_LABEL,
      url,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] checkout CTA send failed:', err)
  }
}

async function liveImageForCard(
  shopify: ShopifyStoreConfig,
  card: ShopifyProductCard,
): Promise<string | null> {
  const handle = handleFromProductUrl(card.productUrl)
  if (!handle) return null
  try {
    const live = await getProductLive(shopify, handle)
    return live?.imageUrl ?? null
  } catch (err) {
    console.warn('[ai auto-reply] live image fetch failed:', err)
    return null
  }
}

function handleFromProductUrl(url: string): string | null {
  const match = url.match(/\/products\/([^/?#]+)/)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

async function sendCatalogImage(
  sendArgs: {
    accountId: string
    userId: string
    conversationId: string
    contactId: string
  },
  card: ShopifyProductCard & { imageUrl: string },
): Promise<boolean> {
  try {
    await engineSendMedia({
      ...sendArgs,
      kind: 'image',
      link: card.imageUrl,
      caption: card.caption,
      aiGenerated: true,
    })
    return true
  } catch (err) {
    console.error('[ai auto-reply] product image send failed:', err)
  }
  try {
    const hosted = await rehostPublicImage({
      accountId: sendArgs.accountId,
      sourceUrl: card.imageUrl,
    })
    await engineSendMedia({
      ...sendArgs,
      kind: 'image',
      link: hosted,
      caption: card.caption,
      aiGenerated: true,
    })
    return true
  } catch (err) {
    console.error('[ai auto-reply] catalog image rehost/send failed:', err)
    return false
  }
}
