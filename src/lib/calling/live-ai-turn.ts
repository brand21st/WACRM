import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { buildSystemPrompt, FULL_AGENT_FALLBACK_REPLY } from '@/lib/ai/defaults'
import { speakableFirstName } from '@/lib/ai/customer-name'
import { latestUserMessage } from '@/lib/ai/query'
import { canSpeak, canTranscribe, transcribeSpeech, synthesizeSpeech } from '@/lib/ai/speech'
import { prepareIndicSpeechText, stripUrlsForSpeech } from '@/lib/ai/speech-text'
import { detectSpokenIndicTarget } from '@/lib/ai/indic-language'
import {
  bindShopifyTools,
  generateCustomerFacingReply,
  sendProductCards,
} from '@/lib/ai/auto-reply'
import {
  loadShopifyConfig,
  retrieveShopifyStoreContent,
} from '@/lib/shopify'
import type { ShopifyProductCard } from '@/lib/shopify'
import { persistCallTurnMessage } from '@/lib/calling/persist-call-turn'
import type { Call } from '@/types'
import type { ChatMessage } from '@/lib/ai/types'

export const LIVE_AI_GREETING_USER =
  '[The customer just connected on a WhatsApp voice call. Greet them in one short spoken sentence and offer to help.]'

export const LIVE_AI_HANDOFF_SPOKEN =
  "I'm connecting you with a teammate now. Please stay on the line."

export type LiveAiTurnKind = 'greeting' | 'utterance'

export interface LiveAiTurnResult {
  skipped?: boolean
  transcript: string
  reply: string
  audioBase64: string | null
  mimeType: string | null
  handoff: boolean
  productCards: ShopifyProductCard[]
}

export const GREETING_FALLBACK = 'Hi, how can I help you?'

export async function runLiveAiTurn(args: {
  accountId: string
  userId: string
  callId: string
  kind: LiveAiTurnKind
  audio?: { bytes: Buffer; mimeType: string; fileName: string }
  /** Persist a client-played greeting without generating a second one. */
  persistOnly?: boolean
  spokenReply?: string
  db?: SupabaseClient
}): Promise<LiveAiTurnResult> {
  const db = args.db ?? supabaseAdmin()
  const empty: LiveAiTurnResult = {
    skipped: true,
    transcript: '',
    reply: '',
    audioBase64: null,
    mimeType: null,
    handoff: false,
    productCards: [],
  }

  const { data: callRow, error: callErr } = await db
    .from('calls')
    .select('*')
    .eq('id', args.callId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (callErr || !callRow) {
    throw Object.assign(new Error('Call not found'), { status: 404, code: 'not_found' })
  }
  const call = callRow as Call
  if (call.status !== 'connecting' && call.status !== 'in_progress') {
    throw Object.assign(new Error('Call is not in progress'), {
      status: 409,
      code: 'bad_state',
    })
  }
  if (!call.ai_answered) {
    throw Object.assign(new Error('Call was not answered by the AI station'), {
      status: 409,
      code: 'not_ai',
    })
  }
  if (!call.conversation_id || !call.contact_id) {
    throw Object.assign(new Error('Call has no conversation'), {
      status: 409,
      code: 'no_conversation',
    })
  }

  if (args.persistOnly && args.kind === 'greeting') {
    const reply = (args.spokenReply || GREETING_FALLBACK).trim() || GREETING_FALLBACK
    await persistCallTurnMessage(db, {
      conversationId: call.conversation_id,
      direction: 'out',
      callId: call.id,
      text: reply,
    })
    return {
      transcript: '',
      reply,
      audioBase64: null,
      mimeType: null,
      handoff: false,
      productCards: [],
    }
  }

  const config = await loadAiConfig(db, args.accountId)
  if (!config || !canTranscribe(config) || !canSpeak(config)) {
    throw Object.assign(new Error('Live AI is not configured'), {
      status: 400,
      code: 'live_ai_not_ready',
    })
  }

  let transcript = ''
  if (args.kind === 'utterance') {
    if (!args.audio || args.audio.bytes.length === 0) return empty
    transcript = (
      await transcribeSpeech({
        config,
        audio: args.audio.bytes,
        mimeType: args.audio.mimeType,
        fileName: args.audio.fileName,
      })
    ).trim()
    if (!transcript) return empty
    await persistCallTurnMessage(db, {
      conversationId: call.conversation_id,
      direction: 'in',
      callId: call.id,
      text: transcript,
    })
  }

  const shopify = await loadShopifyConfig(db, args.accountId).catch((err) => {
    console.error('[live-ai] loadShopifyConfig failed:', err)
    return null
  })

  const contextMessages = await buildConversationContext(db, call.conversation_id)
  const queryText =
    args.kind === 'greeting' ? LIVE_AI_GREETING_USER : latestUserMessage(contextMessages)
  const [manualKnowledge, storeContent] = await Promise.all([
    retrieveKnowledge(db, args.accountId, config, queryText),
    shopify
      ? retrieveShopifyStoreContent(db, args.accountId, queryText, 5)
      : Promise.resolve([] as string[]),
  ])
  const knowledge = [...storeContent, ...manualKnowledge].slice(0, 8)

  const { data: contactRow } = await db
    .from('contacts')
    .select('name, phone')
    .eq('id', call.contact_id)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const productCards: ShopifyProductCard[] = []
  const shopifyTools = bindShopifyTools(
    db,
    shopify,
    contactRow?.phone ?? null,
    productCards,
    { imageTurn: false },
  )

  const customerName = speakableFirstName(contactRow?.name)
  const firstInbound =
    args.kind === 'greeting' || !contextMessages.some((m) => m.role === 'user')
  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    shopify: Boolean(shopify),
    customerName,
    firstInbound,
    shopName: shopify?.shopName,
  })

  const modelMessages: ChatMessage[] =
    args.kind === 'greeting'
      ? [...contextMessages, { role: 'user', content: LIVE_AI_GREETING_USER }]
      : contextMessages

  const generated = await generateCustomerFacingReply({
    db,
    config,
    accountId: args.accountId,
    conversationId: call.conversation_id,
    systemPrompt,
    messages: modelMessages,
    knowledge,
    shopify: Boolean(shopify),
    customerName,
    firstInbound,
    shopName: shopify?.shopName,
    tools: shopifyTools.tools,
    executeTool: shopifyTools.executeTool,
  })

  const handoff = generated.handoff
  let reply = (generated.text || '').trim()
  if (handoff) {
    reply = LIVE_AI_HANDOFF_SPOKEN
  } else if (!reply) {
    reply = args.kind === 'greeting' ? GREETING_FALLBACK : FULL_AGENT_FALLBACK_REPLY
  }

  await persistCallTurnMessage(db, {
    conversationId: call.conversation_id,
    direction: 'out',
    callId: call.id,
    text: reply,
  })

  if (!handoff && productCards.length > 0) {
    await sendProductCards(
      {
        accountId: args.accountId,
        userId: args.userId,
        conversationId: call.conversation_id,
        contactId: call.contact_id,
      },
      productCards,
      shopify,
    )
  }

  const languageHint = detectSpokenIndicTarget(
    args.kind === 'greeting' ? reply : transcript || latestUserMessage(modelMessages),
  )?.elevenlabs
  const spokenText = prepareIndicSpeechText(stripUrlsForSpeech(reply), languageHint)

  let audioBase64: string | null = null
  let mimeType: string | null = null
  if (spokenText) {
    try {
      const spoken = await synthesizeSpeech({
        config,
        text: spokenText,
        whatsapp: false,
        languageHint,
      })
      audioBase64 = Buffer.from(spoken.bytes).toString('base64')
      mimeType = spoken.mimeType
    } catch (err) {
      console.error('[live-ai] TTS failed:', err)
    }
  }

  return {
    transcript,
    reply,
    audioBase64,
    mimeType,
    handoff,
    productCards,
  }
}
