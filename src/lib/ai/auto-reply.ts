import { supabaseAdmin } from './admin-client'
import { loadAiConfig } from './config'
import { buildConversationContext } from './context'
import {
  emptyContactMemory,
  formatCustomerMemoryBlock,
  loadContactMemory,
  persistLanguageLock,
} from './chat-memory'
import {
  applyLanguageLockToFacts,
  isLanguageChoiceOnly,
  resolveLanguageLock,
  type ChatLanguageLock,
} from './language-lock'
import {
  buildLanguagePickerList,
  languageHelpAsk,
  languageLockConfirmation,
  languageWelcomeHi,
  priorCustomerQuestion,
} from './language-picker'
import { retrieveKnowledge } from './knowledge'
import { generateReply } from './generate'
import { buildSystemPrompt, FULL_AGENT_FALLBACK_REPLY } from './defaults'
import { speakableFirstName } from './customer-name'
import { buildHandoffSummary } from './handoff'
import { logAiUsage } from './usage'
import { latestUserMessage } from './query'
import { engineSendText, engineSendMedia, engineSendTypingIndicator, engineSendInteractiveButtons, engineSendInteractiveList, engineSendCtaUrl, engineSendCatalogMessage } from '@/lib/flows/meta-send'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import {
  INBOUND_VOICE_PLACEHOLDER,
  resolveReplyChannels,
  type InboundModality,
} from './voice'
import { canSpeak as ttsReady, synthesizeSpeech } from './speech'
import { prepareIndicSpeechText, stripUrlsForSpeech } from './speech-text'
import { splitShoppingReply } from './shopping-voice'
import { isShopifyProductAsk, MAX_PRODUCT_CARDS } from '@/lib/ai/product-card-limit'
import {
  CHECKOUT_BUTTON_LABEL,
  VIEW_CART_BUTTON_LABEL,
  cardHasCheckout,
  ctaBodyFromCard,
  stripCheckoutUrlsFromReply,
} from './checkout-cta'
import { stripOrderUrlsFromReply } from './order-card'
import { detectSpokenIndicTarget } from './indic-language'
import { uploadGeneratedAudio } from '@/lib/elevenlabs/storage'
import { realtimeTurn } from './realtime'
import { pcm16ToOggOpus } from '@/lib/audio/pcm-to-opus'
import {
  loadShopifyConfig,
  shopifyLlmTools,
  executeShopifyTool,
  retrieveShopifyStoreContent,
  matchProductsFromPhoto,
  toCard,
  getProductLive,
  buildCartOffer,
  resolveCartOfferItems,
  cartOfferFallbackText,
} from '@/lib/shopify'
import {
  resolveVariantPicker,
  parseVariantPickerAction,
  buildColorPickerRows,
  buildSizePickerRows,
  sizeRowsFromProduct,
  handleFromProductUrl,
} from '@/lib/shopify/match-variant'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { nativeCommerceEnabled } from '@/lib/commerce/types'
import {
  tryCompleteCommerceAddress,
  tryCompleteCommerceDiscount,
  tryCompleteCommerceEmail,
} from '@/lib/commerce/checkout'
import type { CartOffer, ShopifyOrderCard, ShopifyProductCard, ShopifyProductHit, ShopifyStoreConfig } from '@/lib/shopify'
import { rehostPublicImage } from '@/lib/storage/generated-media'
import type { ExecuteLlmTool, LlmToolDef } from './providers/shared'
import type { AiConfig, ChatMessage } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'
import type { InteractiveListRow } from '@/lib/whatsapp/interactive'
import type { RetailerIdSource } from '@/lib/shopify/retailer-id'
import {
  buildCartOfferButtons,
  lastMessageHasAction,
  WACRM_CHAT_BUTTON_IDS,
} from './chat-buttons'
import { wantsWhatsAppCatalog } from './catalog-intent'

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
 *     unless full-agent mode is on
 *   - the per-conversation reply cap is reached, unless full-agent
 *     mode is on or the account is set to unlimited
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

    const { data: conv, error: convErr } = await db
      .from('conversations')
      .select('assigned_agent_id, ai_autoreply_disabled, ai_reply_count')
      .eq('id', conversationId)
      .maybeSingle()
    if (convErr || !conv) return
    if (conv.assigned_agent_id) return // a human owns this thread
    if (conv.ai_autoreply_disabled && !config.fullAgentEnabled) return

    const { data: liveCalls } = await db
      .from('calls')
      .select('id')
      .eq('conversation_id', conversationId)
      .in('status', ['connecting', 'in_progress'])
      .limit(1)
    if (liveCalls && liveCalls.length > 0) return

    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound). Full-agent owns
    // the thread — a silent cap looks like a dead bot.
    if (
      !config.fullAgentEnabled &&
      !config.autoReplyUnlimited &&
      conv.ai_reply_count >= config.autoReplyMaxPerConversation
    )
      return

    const messages = await buildConversationContext(db, conversationId)
    if (messages.length === 0) {
      if (inboundContentType !== 'audio') return
      messages.push({ role: 'user', content: INBOUND_VOICE_PLACEHOLDER })
    }

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
    const commerce = await loadCommerceSettings(db, accountId).catch((err) => {
      console.warn('[ai auto-reply] loadCommerceSettings failed:', err)
      return null
    })
    const nativeCommerce = nativeCommerceEnabled({
      metaCatalogId: commerce?.metaCatalogId ?? shopify?.metaCatalogId,
      waPaymentConfigurationName: commerce?.waPaymentConfigurationName,
    })

    const queryText = latestUserMessage(messages)
    const contactMemory = await loadContactMemory(db, accountId, contactId).catch(
      (err) => {
        console.warn('[ai auto-reply] loadContactMemory failed:', err)
        return emptyContactMemory()
      },
    )
    const resolvedLanguage = resolveLanguageLock({
      customerText: queryText,
      stored: contactMemory.facts,
    })
    let memoryForPrompt = contactMemory
    if (resolvedLanguage.lock && resolvedLanguage.changed) {
      try {
        memoryForPrompt = await persistLanguageLock({
          db,
          accountId,
          contactId,
          conversationId,
          lock: resolvedLanguage.lock,
          existing: contactMemory,
        })
      } catch (err) {
        console.warn('[ai auto-reply] persistLanguageLock failed:', err)
        memoryForPrompt = {
          ...contactMemory,
          facts: applyLanguageLockToFacts(contactMemory.facts, resolvedLanguage.lock),
        }
      }
    }
    const replyLanguage = resolvedLanguage.lock
    const customerMemory = formatCustomerMemoryBlock(memoryForPrompt) || null

    const { data: contactRow } = await db
      .from('contacts')
      .select('name, phone')
      .eq('id', contactId)
      .eq('account_id', accountId)
      .maybeSingle()

    const sendArgs = {
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
    }
    const customerName = speakableFirstName(contactRow?.name)
    const languageChoiceOnly = isLanguageChoiceOnly(queryText)

    if (!replyLanguage?.locked && !languageChoiceOnly) {
      await sendWelcomeLanguagePicker({
        sendArgs,
        firstName: customerName,
      })
      return
    }

    if (languageChoiceOnly && replyLanguage?.locked) {
      await engineSendText({
        ...sendArgs,
        text: languageLockConfirmation(replyLanguage),
        aiGenerated: true,
      })
      if (!priorCustomerQuestion(messages)) {
        await engineSendText({
          ...sendArgs,
          text: languageHelpAsk(replyLanguage),
          aiGenerated: true,
        })
        return
      }
    }

    // Deterministic, user-configured responders win over the LLM for
    // typed messages — unless full-agent mode is on. Voice notes and
    // images skip that stand-down: they are the agent's job. Language
    // picker taps also skip it so the lock can persist.
    if (
      !config.fullAgentEnabled &&
      inboundContentType === 'text' &&
      !languageChoiceOnly
    ) {
      const { data: autoResponders } = await db
        .from('automations')
        .select('id')
        .eq('account_id', accountId)
        .eq('is_active', true)
        .in('trigger_type', ['new_message_received', 'keyword_match'])
        .limit(1)
      if (autoResponders && autoResponders.length > 0) return
    }

    const retrieveText = priorCustomerQuestion(messages) || queryText
    const [manualKnowledge, storeContent] = await Promise.all([
      retrieveKnowledge(db, accountId, config, retrieveText),
      shopify
        ? retrieveShopifyStoreContent(db, accountId, retrieveText, 5)
        : Promise.resolve([] as string[]),
    ])
    const knowledge = [...storeContent, ...manualKnowledge].slice(0, 8)

    if (nativeCommerce && queryText.trim()) {
      const handledEmail = await tryCompleteCommerceEmail({
        db,
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        contactPhone: contactRow?.phone ?? null,
        text: queryText,
      })
      if (handledEmail) return
      const handledDiscount = await tryCompleteCommerceDiscount({
        db,
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        text: queryText,
      })
      if (handledDiscount) return
      const handledAddress = await tryCompleteCommerceAddress({
        db,
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        contactName: contactRow?.name ?? null,
        text: queryText,
      })
      if (handledAddress) return
    }

    const productCards: ShopifyProductCard[] = []
    const orderCards: ShopifyOrderCard[] = []
    const cartOfferHolder: { value: CartOffer | null } = { value: null }
    const catalogHolder: { value: boolean } = { value: false }
    const metaCatalogId = (
      commerce?.metaCatalogId ?? shopify?.metaCatalogId
    )?.trim()
    const whatsappCatalog = Boolean(metaCatalogId)
    const imageTurn = inboundContentType === 'image'
    const shopifyTools = bindShopifyTools(
      db,
      shopify,
      contactRow?.phone ?? null,
      productCards,
      {
        imageTurn,
        customerImageUrl: inboundMediaUrl,
        customerMediaId: inboundMediaId,
        accessToken: inboundAccessToken,
        apiKey: config.provider === 'openai' ? config.apiKey : null,
        conversationId,
        cartOffer: cartOfferHolder,
        nativeCommerce,
        retailerIdSource: commerce?.retailerIdSource,
        whatsappCatalog,
        sendCatalog: catalogHolder,
        orderCards,
        customerInterest: {
          products: memoryForPrompt.facts.products,
          preferences: memoryForPrompt.facts.preferences,
          intent: memoryForPrompt.facts.intent,
        },
        customerText: queryText,
      },
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

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      shopify: Boolean(shopify),
      nativeCommerce,
      whatsappCatalog,
      photoMatches,
      customerName,
      firstInbound: isFirstInbound,
      shopName: shopify?.shopName,
      customerMemory,
      replyLanguage,
    })

    const channels = resolveReplyChannels(
      config.voiceReplyMode,
      inboundContentType,
    )
    const fullAgentInboundVoice =
      config.fullAgentEnabled &&
      inboundContentType === 'audio' &&
      ttsReady(config)
    const wantsAudio = channels.includes('audio') || fullAgentInboundVoice
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
              text: stripReplyLinkUrls(spoken.text, productCards, orderCards),
              messages,
              shopify: false,
              wantsText: true,
              wantsAudio: true,
              audioSent: true,
              productCards,
              orderCards,
            })
            if (handedOff) return
          }
          await sendProductCards(sendArgs, productCards, shopify)
          await sendOrderCards(sendArgs, orderCards)
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
      nativeCommerce,
      whatsappCatalog,
      photoMatches,
      customerName,
      firstInbound: isFirstInbound,
      shopName: shopify?.shopName,
      customerMemory,
      replyLanguage,
      tools: shopifyTools.tools,
      executeTool: shopifyTools.executeTool,
    })

    const confirmTap = lastMessageHasAction(
      messages,
      WACRM_CHAT_BUTTON_IDS.confirmOrder,
    )
    const moreOptionsTap = lastMessageHasAction(
      messages,
      WACRM_CHAT_BUTTON_IDS.moreOptions,
    )

    let cartOffer = nativeCommerce
      ? null
      : moreOptionsTap
        ? null
        : cartOfferHolder.value
    if (!cartOffer && !moreOptionsTap && shopify && confirmTap && !nativeCommerce) {
      const items = await resolveCartOfferItems({
        db,
        conversationId,
        cards: productCards,
      })
      cartOffer = buildCartOffer(shopify.primaryDomain, items)
    }

    if (nativeCommerce && confirmTap && !text?.trim()) {
      await engineSendText({
        ...sendArgs,
        text: 'Add the items to your WhatsApp cart, then tap Send order. I’ll send a Review and Pay bill in this chat.',
        aiGenerated: true,
      })
      await sendProductCards(sendArgs, productCards, shopify)
      await sendOrderCards(sendArgs, orderCards)
      return
    }

    if ((handoff || !text) && !(confirmTap && cartOffer)) {
      await maybeHandoff(db, config, conv, conversationId, messages)
      return
    }

    if (!(await claimReplySlot(db, conversationId, config))) return

    const { chatText, voiceText } = splitShoppingReply(text ?? '')
    const replyText =
      confirmTap && cartOffer && (!(chatText ?? '').trim() || handoff)
        ? cartOfferFallbackText(cartOffer.items)
        : chatText || voiceText || text
    const textForCustomer =
      stripReplyLinkUrls(
        replyText,
        productCards,
        orderCards,
        [cartOffer?.cartUrl, cartOffer?.checkoutUrl],
      ).trim() || FULL_AGENT_FALLBACK_REPLY

    const catalogBrowseAsk = wantsWhatsAppCatalog({
      customerText: queryText,
      replyText: textForCustomer,
      messages,
      toolRequested: catalogHolder.value,
    })
    if (
      catalogBrowseAsk &&
      shopify &&
      productCards.length === 0 &&
      !cartOffer &&
      shopifyTools.executeTool
    ) {
      try {
        await shopifyTools.executeTool('list_new_arrivals', {})
      } catch (err) {
        console.warn('[ai auto-reply] catalog product cards failed:', err)
      }
    } else if (
      inboundContentType === 'audio' &&
      shopify &&
      productCards.length === 0 &&
      !cartOffer &&
      isShopifyProductAsk(queryText) &&
      shopifyTools.executeTool
    ) {
      try {
        await shopifyTools.executeTool('search_products', { query: queryText })
      } catch (err) {
        console.warn('[ai auto-reply] voice product search failed:', err)
      }
    }
    const pickerTap = parseVariantPickerAction(queryText)
    const hasVoiceScript = Boolean(voiceText)
    const compiledVoice =
      ttsReady(config) &&
      (config.voiceReplyMode !== 'text' || fullAgentInboundVoice) &&
      (hasVoiceScript || wantsAudio)

    const languageHint =
      replyLanguage?.code ??
      detectSpokenIndicTarget(latestUserMessage(messages))?.elevenlabs
    const spokenSource = voiceText || (compiledVoice ? textForCustomer : replyText)
    const spokenText = prepareIndicSpeechText(
      stripUrlsForSpeech(spokenSource),
      languageHint,
    )
    const canSpeak = ttsReady(config) && Boolean(spokenText)
    const speakAfterText = hasVoiceScript && compiledVoice

    const sendShoppingAudio = async () => {
      if (!canSpeak) return false
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
          contentText: textForCustomer,
          aiGenerated: true,
          voice: true,
        })
        return true
      } catch (err) {
        console.error('[ai auto-reply] TTS/audio send failed:', err)
        return false
      }
    }

    if (pickerTap && shopify && !cartOffer) {
      try {
        const picked = await getProductLive(shopify, pickerTap.handle)
        if (picked) {
          const pickedResult = await applyVariantPicker({
            sendArgs,
            product: picked,
            ask: queryText,
            bodyText: textForCustomer,
            chosenColor: pickerTap.color,
            chosenSize: pickerTap.kind === 'size' ? pickerTap.size : null,
            fromTap: pickerTap.kind,
            productCards,
            retailerIdSource: commerce?.retailerIdSource,
          })
          if (pickedResult === 'picker') {
            if (compiledVoice) await sendShoppingAudio()
            return
          }
          if (pickedResult === 'oos') {
            await engineSendText({
              ...sendArgs,
              text:
                textForCustomer.trim() ||
                `${picked.title} is out of stock in that option.`,
              aiGenerated: true,
            })
            return
          }
        }
      } catch (err) {
        console.warn('[ai auto-reply] variant picker tap failed:', err)
      }
    } else if (
      shopify &&
      !catalogBrowseAsk &&
      !cartOffer &&
      productCards.length === 1
    ) {
      const handle =
        productCards[0].handle?.trim() ||
        handleFromProductUrl(productCards[0].productUrl)
      if (handle) {
        try {
          const listed = await getProductLive(shopify, handle)
          if (listed) {
            const listedResult = await applyVariantPicker({
              sendArgs,
              product: listed,
              ask: queryText,
              bodyText: textForCustomer,
              productCards,
              retailerIdSource: commerce?.retailerIdSource,
            })
            if (listedResult === 'picker') {
              if (compiledVoice) await sendShoppingAudio()
              return
            }
            if (listedResult === 'oos') {
              await engineSendText({
                ...sendArgs,
                text:
                  textForCustomer.trim() ||
                  `${listed.title} is out of stock in that option.`,
                aiGenerated: true,
              })
              return
            }
          }
        } catch (err) {
          console.warn('[ai auto-reply] variant picker failed:', err)
        }
      }
    }
    const isProductRec =
      Boolean(shopify) &&
      productCards.length > 0 &&
      !cartOffer

    if (isProductRec) {
      const speakWithCards =
        inboundContentType === 'audio' && compiledVoice && canSpeak
      const voicePending = speakWithCards ? sendShoppingAudio() : null
      try {
        await sendProductCards(sendArgs, productCards, shopify)
      } catch (err) {
        console.error('[ai auto-reply] product cards failed:', err)
      }
      if (catalogBrowseAsk && metaCatalogId) {
        await sendWhatsAppCatalogMessage(sendArgs, textForCustomer)
      }
      const handedOff = await sendCustomerFacingText({
        db,
        config,
        conv,
        conversationId,
        sendArgs,
        text: textForCustomer,
        messages,
        shopify: Boolean(shopify),
        wantsText: true,
        wantsAudio: compiledVoice || wantsAudio,
        audioSent: Boolean(voicePending),
        productCards,
        orderCards,
        chatButtonMode: 'nav',
      })
      if (handedOff) {
        if (voicePending) await voicePending.catch(() => false)
        return
      }
      if (voicePending) await voicePending
      else if (compiledVoice) await sendShoppingAudio()
      try {
        await sendOrderCards(sendArgs, orderCards)
      } catch (err) {
        console.error('[ai auto-reply] order cards failed:', err)
      }
      return
    }

    if (catalogBrowseAsk && metaCatalogId) {
      await sendWhatsAppCatalogMessage(sendArgs, textForCustomer)
      const handedOff = await sendCustomerFacingText({
        db,
        config,
        conv,
        conversationId,
        sendArgs,
        text: textForCustomer,
        messages,
        shopify: Boolean(shopify),
        wantsText: true,
        wantsAudio: compiledVoice || wantsAudio,
        audioSent: false,
        productCards,
        orderCards,
        chatButtonMode: 'nav',
      })
      if (handedOff) return
      try {
        await sendOrderCards(sendArgs, orderCards)
      } catch (err) {
        console.error('[ai auto-reply] order cards failed:', err)
      }
      if (compiledVoice) await sendShoppingAudio()
      return
    }

    let audioSent = false
    if (compiledVoice && canSpeak && !speakAfterText) {
      audioSent = await sendShoppingAudio()
    }

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
      wantsAudio: compiledVoice || wantsAudio,
      audioSent,
      productCards,
      orderCards,
      chatButtonMode: cartOffer ? (confirmTap ? 'none' : 'cart') : 'nav',
    })
    if (handedOff) return

    if (cartOffer) {
      await sendCartOffer(sendArgs, cartOffer)
      await sendOrderCards(sendArgs, orderCards)
      if (speakAfterText) await sendShoppingAudio()
      return
    }

    await sendProductCards(sendArgs, productCards, shopify)
    await sendOrderCards(sendArgs, orderCards)
    if (speakAfterText) await sendShoppingAudio()
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

async function sendWelcomeLanguagePicker(args: {
  sendArgs: SendArgs
  firstName: string | null
}): Promise<void> {
  const list = buildLanguagePickerList()
  await engineSendText({
    ...args.sendArgs,
    text: languageWelcomeHi(args.firstName),
    aiGenerated: true,
  })
  await engineSendInteractiveList({
    ...args.sendArgs,
    bodyText: list.bodyText,
    buttonLabel: list.buttonLabel,
    sections: list.sections,
    aiGenerated: true,
  })
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
  orderCards?: ShopifyOrderCard[]
  chatButtonMode?: 'nav' | 'cart' | 'none'
}): Promise<boolean> {
  const mode = args.chatButtonMode ?? 'nav'
  const chatButtons =
    args.config.fullAgentEnabled && mode === 'cart'
      ? buildCartOfferButtons()
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
    args.productCards.length > 0 ||
    (args.orderCards?.length ?? 0) > 0 ||
    mode === 'cart' ||
    mode === 'none'
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
      max_replies:
        config.fullAgentEnabled || config.autoReplyUnlimited
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

export async function generateCustomerFacingReply(args: {
  db: SupabaseClient
  config: AiConfig
  accountId: string
  conversationId: string
  systemPrompt: string
  messages: ChatMessage[]
  knowledge: string[]
  shopify?: boolean
  nativeCommerce?: boolean
  whatsappCatalog?: boolean
  photoMatches?: Awaited<ReturnType<typeof matchProductsFromPhoto>>
  customerName?: string | null
  firstInbound?: boolean
  shopName?: string | null
  customerMemory?: string | null
  replyLanguage?: ChatLanguageLock | null
  tools?: LlmToolDef[]
  executeTool?: ExecuteLlmTool
}): Promise<{ text: string; handoff: boolean }> {
  try {
    const first = await generateReply({
      config: args.config,
      systemPrompt: args.systemPrompt,
      messages: args.messages,
      customerName: args.customerName,
      replyLanguage: args.replyLanguage,
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
        nativeCommerce: args.nativeCommerce,
        whatsappCatalog: args.whatsappCatalog,
        photoMatches: args.photoMatches,
        customerName: args.customerName,
        firstInbound: args.firstInbound,
        shopName: args.shopName,
        customerMemory: args.customerMemory,
        replyLanguage: args.replyLanguage,
      }),
      messages: args.messages,
      customerName: args.customerName,
      replyLanguage: args.replyLanguage,
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
  } catch (err) {
    console.error('[ai auto-reply] generate failed:', err)
    if (args.config.fullAgentEnabled) {
      return { text: FULL_AGENT_FALLBACK_REPLY, handoff: false }
    }
    return { text: '', handoff: true }
  }
}

export function bindShopifyTools(
  db: SupabaseClient,
  shopify: ShopifyStoreConfig | null,
  contactPhone: string | null,
  productCards: ShopifyProductCard[],
  opts: {
    imageTurn: boolean
    customerImageUrl?: string | null
    customerMediaId?: string | null
    accessToken?: string | null
    apiKey?: string | null
    conversationId?: string | null
    cartOffer?: { value: CartOffer | null }
    nativeCommerce?: boolean
    retailerIdSource?: import('@/lib/shopify/retailer-id').RetailerIdSource
    whatsappCatalog?: boolean
    sendCatalog?: { value: boolean }
    orderCards?: ShopifyOrderCard[]
    customerInterest?: import('@/lib/shopify').CustomerProductInterest
    customerText?: string | null
  } = { imageTurn: false },
): { tools?: LlmToolDef[]; executeTool?: ExecuteLlmTool } {
  if (!shopify) return {}
  const whatsappCatalog = Boolean(
    opts.whatsappCatalog ?? shopify.metaCatalogId?.trim(),
  )
  return {
    tools: shopifyLlmTools({ whatsappCatalog }),
    executeTool: async (name, args) => {
      const result = await executeShopifyTool(
        {
          db,
          config: shopify,
          contactPhone,
          photoMatch: {
            customerImageUrl: opts.customerImageUrl,
            customerMediaId: opts.customerMediaId,
            accessToken: opts.accessToken,
            apiKey: opts.apiKey,
          },
          productCards,
          conversationId: opts.conversationId,
          nativeCommerce: opts.nativeCommerce,
          retailerIdSource: opts.retailerIdSource,
          customerInterest: opts.customerInterest,
          customerText: opts.customerText,
        },
        name,
        args,
      )
      const skipCards =
        opts.imageTurn &&
        (name === 'search_products' ||
          name === 'list_new_arrivals' ||
          name === 'list_best_selling' ||
          name === 'recommend_products')
      if (!skipCards && !result.sendCatalog) productCards.push(...result.cards)
      if (result.orderCards?.length && opts.orderCards) {
        opts.orderCards.push(...result.orderCards)
      }
      if (result.cartOffer && opts.cartOffer) {
        opts.cartOffer.value = result.cartOffer
      }
      if (result.sendCatalog && opts.sendCatalog) {
        opts.sendCatalog.value = true
      }
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

const MAX_ORDER_CARDS = 3

function stripReplyLinkUrls(
  text: string,
  productCards: ShopifyProductCard[],
  orderCards: ShopifyOrderCard[],
  extra: (string | null | undefined)[] = [],
): string {
  return stripOrderUrlsFromReply(
    stripCheckoutUrlsFromReply(text, [
      ...productCards.map((c) => c.checkoutUrl),
      ...productCards.map((c) => c.cartUrl),
      ...extra,
    ]),
    orderCards,
  )
}

async function applyVariantPicker(args: {
  sendArgs: SendArgs
  product: ShopifyProductHit
  ask: string
  bodyText: string
  chosenColor?: string | null
  chosenSize?: string | null
  fromTap?: 'color' | 'size'
  productCards: ShopifyProductCard[]
  retailerIdSource?: RetailerIdSource
}): Promise<'picker' | 'card' | 'oos'> {
  const next = resolveVariantPicker({
    product: args.product,
    ask: args.ask,
    chosenColor: args.chosenColor,
    chosenSize: args.chosenSize,
  })
  if (next.kind === 'color') {
    const rows = buildColorPickerRows(args.product.handle, next.colors)
    if (rows.length === 0) return 'oos'
    await sendVariantOptionList({
      sendArgs: args.sendArgs,
      kind: 'color',
      title: args.product.title,
      rows,
      bodyText: args.bodyText,
    })
    return 'picker'
  }
  if (next.kind === 'size') {
    const color = next.color ?? args.chosenColor ?? null
    const rows = buildSizePickerRows(
      args.product.handle,
      color,
      sizeRowsFromProduct(args.product, color),
    )
    if (rows.length === 0) return 'oos'
    await sendVariantOptionList({
      sendArgs: args.sendArgs,
      kind: 'size',
      title: args.product.title,
      rows,
      bodyText: args.bodyText,
    })
    return 'picker'
  }
  if (next.kind === 'done' && !next.variant) {
    return 'card'
  }
  if (next.kind === 'done' && next.variant) {
    const needsConfirm =
      Boolean(next.color || next.size) &&
      args.fromTap !== 'size' &&
      !(args.fromTap === 'color' && !next.size)
    if (needsConfirm && next.size) {
      const color = next.color ?? args.chosenColor ?? null
      await sendVariantOptionList({
        sendArgs: args.sendArgs,
        kind: 'size',
        title: args.product.title,
        rows: buildSizePickerRows(args.product.handle, color, [
          {
            size: next.size,
            price: next.variant.price
              ? args.product.currency
                ? `${next.variant.price} ${args.product.currency}`
                : next.variant.price
              : null,
          },
        ]),
        bodyText: args.bodyText,
      })
      return 'picker'
    }
    if (needsConfirm && next.color && !next.size) {
      await sendVariantOptionList({
        sendArgs: args.sendArgs,
        kind: 'color',
        title: args.product.title,
        rows: buildColorPickerRows(args.product.handle, [next.color]),
        bodyText: args.bodyText,
      })
      return 'picker'
    }
    args.productCards.length = 0
    args.productCards.push(
      toCard(args.product, args.retailerIdSource ?? 'sku', next.variant),
    )
    return 'card'
  }
  return 'oos'
}

async function sendVariantOptionList(args: {
  sendArgs: SendArgs
  kind: 'color' | 'size'
  title: string
  rows: InteractiveListRow[]
  bodyText: string
}): Promise<void> {
  const fallback =
    args.kind === 'color'
      ? `Choose a color for ${args.title}.`
      : `Choose a size for ${args.title}.`
  await engineSendInteractiveList({
    ...args.sendArgs,
    bodyText: (args.bodyText.trim() || fallback).slice(0, INTERACTIVE_LIMITS.bodyMaxLength),
    buttonLabel: args.kind === 'color' ? 'Choose color' : 'Choose size',
    sections: [{ title: 'In stock', rows: args.rows }],
    aiGenerated: true,
  })
}

const CATALOG_MESSAGE_FALLBACK = 'Browse our catalog'

export async function sendWhatsAppCatalogMessage(
  sendArgs: {
    accountId: string
    userId: string
    conversationId: string
    contactId: string
  },
  bodyText: string,
): Promise<boolean> {
  const body = (bodyText.trim() || CATALOG_MESSAGE_FALLBACK).slice(0, 1024)
  try {
    await engineSendCatalogMessage({
      ...sendArgs,
      bodyText: body,
      aiGenerated: true,
    })
    return true
  } catch (err) {
    console.error('[ai auto-reply] catalog message send failed:', err)
    return false
  }
}

export async function sendProductCards(
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
    if (checkout && imageUrl) {
      const ok = await sendCheckoutProductCard(sendArgs, card, imageUrl)
      if (ok) {
        sent += 1
        continue
      }
    }
    if (imageUrl) {
      const ok = await sendCatalogImage(sendArgs, { ...card, imageUrl })
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

export async function sendOrderCards(
  sendArgs: {
    accountId: string
    userId: string
    conversationId: string
    contactId: string
  },
  cards: ShopifyOrderCard[],
): Promise<void> {
  const seen = new Set<string>()
  let sent = 0
  for (const card of cards) {
    if (sent >= MAX_ORDER_CARDS) break
    const key = card.orderName || card.bodyText
    if (!key || seen.has(key)) continue
    seen.add(key)
    const body = card.bodyText.trim().slice(0, 1024)
    if (!body) continue
    const url = card.url?.trim()
    const label = card.buttonLabel?.trim()
    if (url && label) {
      try {
        await engineSendCtaUrl({
          ...sendArgs,
          bodyText: body,
          displayText: label,
          url,
          aiGenerated: true,
        })
        sent += 1
        continue
      } catch (err) {
        console.error('[ai auto-reply] order tracking card send failed:', err)
      }
    }
    try {
      await engineSendText({
        ...sendArgs,
        text: body,
        aiGenerated: true,
      })
      sent += 1
    } catch (err) {
      console.error('[ai auto-reply] order card text send failed:', err)
    }
  }
}

async function sendCartOffer(
  sendArgs: SendArgs,
  offer: CartOffer,
): Promise<void> {
  const body = (offer.summaryLines.join('\n') || 'Your cart').slice(0, 1024)
  try {
    await engineSendCtaUrl({
      ...sendArgs,
      bodyText: body,
      displayText: VIEW_CART_BUTTON_LABEL,
      url: offer.cartUrl,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] view cart CTA send failed:', err)
  }
  try {
    await engineSendCtaUrl({
      ...sendArgs,
      bodyText: body,
      displayText: CHECKOUT_BUTTON_LABEL,
      url: offer.checkoutUrl,
      headerImageUrl: offer.items.find((item) => item.imageUrl)?.imageUrl ?? undefined,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[ai auto-reply] cart checkout CTA send failed:', err)
  }
}

async function sendCheckoutProductCard(
  sendArgs: SendArgs,
  card: ShopifyProductCard,
  imageUrl: string,
): Promise<boolean> {
  const url = card.checkoutUrl?.trim()
  if (!url) return false
  try {
    await engineSendCtaUrl({
      ...sendArgs,
      bodyText: ctaBodyFromCard(card),
      displayText: CHECKOUT_BUTTON_LABEL,
      url,
      headerImageUrl: imageUrl,
      aiGenerated: true,
    })
    return true
  } catch (err) {
    console.error('[ai auto-reply] checkout product card send failed:', err)
    return false
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
