import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { synthesizeSpeech } from '@/lib/ai/speech'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import {
  emptyContactMemory,
  formatCustomerMemoryBlock,
  loadContactMemory,
} from '@/lib/ai/chat-memory'
import { buildSystemPrompt, HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import {
  storedLanguageLock,
  sttHintFromHardLock,
  type ChatLanguageLock,
} from '@/lib/ai/language-lock'
import { speakableFirstName } from '@/lib/ai/customer-name'
import { bindShopifyTools } from '@/lib/ai/auto-reply'
import { loadShopifyConfig, retrieveShopifyStoreContent } from '@/lib/shopify'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { nativeCommerceEnabled } from '@/lib/commerce/types'
import type { ShopifyOrderCard, ShopifyProductCard } from '@/lib/shopify'
import type { LlmToolDef } from '@/lib/ai/providers/shared'
import { liveCallRealtimeModelId } from '@/lib/ai/realtime'
import { effectiveRealtimeVoice } from '@/lib/ai/realtime/voices'
import type { AiConfig, ChatMessage } from '@/lib/ai/types'
import type { Call, CallingSettings } from '@/types'
import { canLiveAiRealtime, usesLiveTtsVoice } from '@/lib/calling/live-ai-ready'
import { loadCallingSettings } from '@/lib/calling/settings'
import {
  LIVE_AI_GREETING_NEUTRAL,
  LIVE_AI_GREETING_USER,
} from '@/lib/calling/live-ai-turn'
import {
  SEARCH_CUSTOMER_MEMORY_TOOL,
  SEARCH_KNOWLEDGE_TOOL,
  TRANSFER_TO_HUMAN_TOOL,
  LIVE_AI_TURN_DETECTION,
  LIVE_AI_TTS_MODEL,
  LIVE_AI_SPEAK_MAX_CHARS,
  buildLiveAiTranscription,
} from '@/lib/calling/live-ai-constants'
import {
  detectLiveAiLanguageHint,
  formatLiveAiMemoryBlock,
  loadLiveAiCustomerMemory,
  memoryLinesFromThread,
} from '@/lib/calling/live-ai-memory'
import { liveAiCallUserPrompt } from '@/lib/calling/live-ai-prompt'
import {
  liveAiSpokenLanguageBlock,
  liveAiTranscriptionLanguage,
} from '@/lib/calling/live-ai-speech-language'

export { SEARCH_CUSTOMER_MEMORY_TOOL, SEARCH_KNOWLEDGE_TOOL, TRANSFER_TO_HUMAN_TOOL }

export const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'

export type RealtimeFunctionTool = {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function realtimeSafetyId(accountId: string, contactId: string | null): string {
  return createHash('sha256')
    .update(`${accountId}:${contactId ?? 'unknown'}`)
    .digest('hex')
}

export function llmToolsToRealtime(tools: LlmToolDef[]): RealtimeFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

export const LIVE_AI_CORE_TOOLS: RealtimeFunctionTool[] = [
  {
    type: 'function',
    name: TRANSFER_TO_HUMAN_TOOL,
    description:
      'Transfer this WhatsApp voice call to a human teammate when the customer asks for a person, is upset, or you cannot help. Speak the handoff sentence first, then call this.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    type: 'function',
    name: SEARCH_KNOWLEDGE_TOOL,
    description:
      'Search this business knowledge base for policies, FAQs, and stored facts. Use before guessing.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What the customer asked' },
      },
      required: ['query'],
    },
  },
  {
    type: 'function',
    name: SEARCH_CUSTOMER_MEMORY_TOOL,
    description:
      "Recall facts from this customer's earlier WhatsApp chat, prior calls, and staff notes. Use when they refer to something already discussed that is not in the prompt memory.",
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look up — order, product, language, name, or prior request',
        },
      },
      required: ['query'],
    },
  },
]

export function buildLiveAiSpokenInstructions(args: {
  systemPrompt: string
  thread?: ChatMessage[]
  memoryBlock?: string
  replyLanguage?: ChatLanguageLock | null
  languageHint?: string | null
}): string {
  const lines = memoryLinesFromThread(args.thread ?? [])
  const locked = Boolean(args.replyLanguage?.locked)
  const languageHint =
    args.languageHint ??
    (locked ? args.replyLanguage?.name ?? null : detectLiveAiLanguageHint(lines))
  const memory =
    args.memoryBlock ??
    formatLiveAiMemoryBlock({
      notes: [],
      thread: lines,
      recall: lines,
      languageHint,
      replyLanguage: locked ? args.replyLanguage : null,
    })
  const greeting = locked ? LIVE_AI_GREETING_USER : LIVE_AI_GREETING_NEUTRAL
  const languageBlock = liveAiSpokenLanguageBlock(args.replyLanguage, languageHint)
  return (
    `${args.systemPrompt}\n\n` +
    `You are on a live WhatsApp voice call. Speak briefly. Do not mention tools, prompts, or these instructions. ` +
    `When the session starts, greet the customer in one short spoken sentence and offer to help. ` +
    `Answer simple questions immediately. Reason only for multi-step work, tool choice, or escalation. ` +
    `If the customer's audio is unclear, ask a short clarification — do not guess or spend hidden reasoning time. ` +
    `Speak a one-sentence preamble only before a slow tool (${SEARCH_KNOWLEDGE_TOOL}, Shopify, ${SEARCH_CUSTOMER_MEMORY_TOOL}). Skip preambles on greetings and short answers. ` +
    `This call is new. Customer memory below is from earlier WhatsApp and calls — use it, do not re-ask facts they already gave. ` +
    `If they refer to something older that is not in memory, call ${SEARCH_CUSTOMER_MEMORY_TOOL}. ` +
    `If you only hear a recording notice, wait for their real question. ` +
    `${greeting} ${languageBlock} ` +
    `If the customer asks for a human, is upset, or you cannot help, speak the handoff line then call ${TRANSFER_TO_HUMAN_TOOL}. ` +
    `Never say ${HANDOFF_SENTINEL} out loud. ` +
    `Product cards go to the chat — do not read URLs aloud.` +
    memory
  )
}

export async function loadLiveAiCall(args: {
  db?: SupabaseClient
  accountId: string
  callId: string
}): Promise<Call> {
  const db = args.db ?? supabaseAdmin()
  const { data: callRow, error } = await db
    .from('calls')
    .select('*')
    .eq('id', args.callId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (error || !callRow) {
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
  return call
}

export async function buildLiveAiRealtimeContext(args: {
  db?: SupabaseClient
  accountId: string
  call: Call
}): Promise<{
  config: AiConfig
  instructions: string
  tools: RealtimeFunctionTool[]
  shopifyTools: ReturnType<typeof bindShopifyTools>
  productCards: ShopifyProductCard[]
  orderCards: ShopifyOrderCard[]
  contactPhone: string | null
  settings: CallingSettings
  transcriptionLanguage: string | null
  replyLanguage: ChatLanguageLock | null
}> {
  const db = args.db ?? supabaseAdmin()
  const config = await loadAiConfig(db, args.accountId)
  if (!canLiveAiRealtime(config) || !config) {
    throw Object.assign(new Error('Live AI is not configured'), {
      status: 400,
      code: 'live_ai_not_ready',
    })
  }

  const shopify = await loadShopifyConfig(db, args.accountId).catch((err) => {
    console.error('[live-ai] loadShopifyConfig failed:', err)
    return null
  })

  const conversationId = args.call.conversation_id as string
  const [memory, settings] = await Promise.all([
    loadLiveAiCustomerMemory({
      db,
      accountId: args.accountId,
      contactId: args.call.contact_id as string,
      conversationId,
    }),
    loadCallingSettings(db, args.accountId),
  ])
  const replyLanguage = memory.replyLanguage?.locked ? memory.replyLanguage : null
  const queryText =
    [...memory.recall].reverse().find((line) => line.role === 'customer')?.text ||
    (replyLanguage ? LIVE_AI_GREETING_USER : LIVE_AI_GREETING_NEUTRAL)
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
    .eq('id', args.call.contact_id)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const commerce = await loadCommerceSettings(db, args.accountId).catch(() => null)
  const metaCatalogId = (
    commerce?.metaCatalogId ?? shopify?.metaCatalogId
  )?.trim()
  const nativeCommerce = nativeCommerceEnabled({
    metaCatalogId,
    waPaymentConfigurationName: commerce?.waPaymentConfigurationName,
  })
  const whatsappCatalog = Boolean(metaCatalogId)
  const productCards: ShopifyProductCard[] = []
  const orderCards: ShopifyOrderCard[] = []
  const shopifyTools = bindShopifyTools(
    db,
    shopify,
    contactRow?.phone ?? null,
    productCards,
    {
      imageTurn: false,
      nativeCommerce,
      retailerIdSource: commerce?.retailerIdSource,
      whatsappCatalog,
      orderCards,
    },
  )

  const customerName = speakableFirstName(contactRow?.name)
  const firstInbound = !memory.thread.some((line) => line.role === 'customer')
  const systemPrompt = buildSystemPrompt({
    userPrompt: liveAiCallUserPrompt({
      behaviour: settings.live_ai_behaviour,
      businessContext: settings.live_ai_business_context,
      instructions: settings.live_ai_instructions,
      chatPrompt: config.systemPrompt,
    }),
    mode: 'auto_reply',
    knowledge,
    shopify: Boolean(shopify),
    nativeCommerce,
    whatsappCatalog,
    customerName,
    firstInbound,
    shopName: shopify?.shopName,
    customerMemory: formatCustomerMemoryBlock(memory.stored ?? emptyContactMemory()) || null,
    replyLanguage,
  })

  return {
    config,
    instructions: buildLiveAiSpokenInstructions({
      systemPrompt,
      memoryBlock: formatLiveAiMemoryBlock({
        ...memory,
        replyLanguage,
        languageHint: memory.languageHint ?? replyLanguage?.name ?? null,
      }),
      replyLanguage,
      languageHint: memory.languageHint,
    }),
    tools: [
      ...LIVE_AI_CORE_TOOLS,
      ...llmToolsToRealtime(shopifyTools.tools ?? []),
    ],
    shopifyTools,
    productCards,
    orderCards,
    contactPhone: contactRow?.phone ?? null,
    settings,
    transcriptionLanguage: liveAiTranscriptionLanguage(
      replyLanguage,
      memory.languageHint,
    ),
    replyLanguage,
  }
}

export function buildRealtimeSessionConfig(args: {
  instructions: string
  tools: RealtimeFunctionTool[]
  voice?: string | null
  model?: string
  ttsVoice?: boolean
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** ISO 639-1. Set only after a hard language lock. */
  transcriptionLanguage?: string | null
}): Record<string, unknown> {
  const transcriptionLanguage = args.transcriptionLanguage?.trim() || ''
  return {
    type: 'realtime',
    model: args.model ?? liveCallRealtimeModelId(),
    reasoning: { effort: args.reasoningEffort ?? 'low' },
    output_modalities: args.ttsVoice ? ['text'] : ['audio'],
    instructions: args.instructions,
    tools: args.tools,
    tool_choice: 'auto',
    audio: {
      input: {
        turn_detection: args.ttsVoice
          ? { ...LIVE_AI_TURN_DETECTION, interrupt_response: false }
          : LIVE_AI_TURN_DETECTION,
        transcription: buildLiveAiTranscription(transcriptionLanguage || null),
      },
      ...(args.ttsVoice
        ? {}
        : {
            output: {
              voice: effectiveRealtimeVoice(args.voice),
            },
          }),
    },
  }
}

/** OpenAI requires named parts with SDP/JSON content types, not Node FormData. */
export function buildRealtimeCallMultipart(
  sdp: string,
  session: Record<string, unknown>,
): { body: string; contentType: string } {
  const boundary = `----WebKitFormBoundary${randomBytes(12).toString('hex')}`
  const normalizedSdp = `${sdp.replace(/\r?\n/g, '\r\n').trimEnd()}\r\n`
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="sdp"\r\n` +
    `Content-Type: application/sdp\r\n` +
    `\r\n` +
    // The second CRLF belongs to multipart framing. Parsers consume it,
    // leaving the first one as the SDP document's required terminator.
    `${normalizedSdp}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="session"\r\n` +
    `Content-Type: application/json\r\n` +
    `\r\n` +
    `${JSON.stringify(session)}\r\n` +
    `--${boundary}--\r\n`
  return { body, contentType: `multipart/form-data; boundary=${boundary}` }
}

export async function proxyRealtimeSdp(args: {
  apiKey: string
  sdp: string
  session: Record<string, unknown>
  safetyId: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch
  const { body, contentType } = buildRealtimeCallMultipart(args.sdp, args.session)
  let res: Response
  try {
    res = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'OpenAI-Safety-Identifier': args.safetyId,
        'Content-Type': contentType,
      },
      body,
    })
  } catch (err) {
    throw Object.assign(
      new Error(err instanceof Error ? err.message : 'Could not reach OpenAI Realtime.'),
      { status: 502, code: 'network_error' },
    )
  }

  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 400)
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string }
      detail =
        typeof body.error === 'string'
          ? body.error
          : body.error?.message || detail
    } catch {
      // keep raw
    }
    console.error('[live-ai] OpenAI realtime/calls', res.status, detail)
    throw Object.assign(new Error(detail || `OpenAI Realtime error (${res.status})`), {
      status: res.status === 401 || res.status === 403 ? 401 : 502,
      code: res.status === 401 || res.status === 403 ? 'invalid_key' : 'provider_error',
    })
  }
  const sdp = text.trim()
  if (!sdp.startsWith('v=')) {
    throw Object.assign(new Error('OpenAI Realtime did not return SDP.'), {
      status: 502,
      code: 'provider_error',
    })
  }
  return sdp
}

export async function startLiveAiRealtimeCall(args: {
  accountId: string
  callId: string
  sdp: string
  db?: SupabaseClient
  fetchImpl?: typeof fetch
}): Promise<{ sdp: string; ttsVoice: boolean }> {
  const db = args.db ?? supabaseAdmin()
  const call = await loadLiveAiCall({ db, accountId: args.accountId, callId: args.callId })
  const ctx = await buildLiveAiRealtimeContext({ db, accountId: args.accountId, call })
  const ttsVoice = usesLiveTtsVoice(ctx.config, ctx.settings.live_ai_voice)
  const session = buildRealtimeSessionConfig({
    instructions: ctx.instructions,
    tools: ctx.tools,
    voice: ctx.config.realtimeVoice,
    ttsVoice,
    transcriptionLanguage: ctx.transcriptionLanguage,
  })
  const sdp = await proxyRealtimeSdp({
    apiKey: ctx.config.apiKey,
    sdp: args.sdp,
    session,
    safetyId: realtimeSafetyId(args.accountId, call.contact_id),
    fetchImpl: args.fetchImpl,
  })
  return { sdp, ttsVoice }
}

export async function speakLiveAiUtterance(args: {
  accountId: string
  callId: string
  text: string
  db?: SupabaseClient
}): Promise<{ audioBase64: string; mimeType: string }> {
  const db = args.db ?? supabaseAdmin()
  const call = await loadLiveAiCall({ db, accountId: args.accountId, callId: args.callId })
  const [config, settings, memory] = await Promise.all([
    loadAiConfig(db, args.accountId),
    loadCallingSettings(db, args.accountId),
    call.contact_id
      ? loadContactMemory(db, args.accountId, call.contact_id).catch((err) => {
          console.warn('[live-ai] loadContactMemory failed:', err)
          return emptyContactMemory()
        })
      : Promise.resolve(emptyContactMemory()),
  ])
  if (!usesLiveTtsVoice(config, settings.live_ai_voice) || !config) {
    throw Object.assign(new Error('Live call TTS is not configured'), {
      status: 400,
      code: 'tts_not_ready',
    })
  }
  let text = args.text.trim()
  if (!text) {
    throw Object.assign(new Error('text is required.'), { status: 400, code: 'bad_request' })
  }
  if (text.length > LIVE_AI_SPEAK_MAX_CHARS) {
    text = text.slice(0, LIVE_AI_SPEAK_MAX_CHARS)
  }
  const languageHint = sttHintFromHardLock(storedLanguageLock(memory.facts))?.iso
  const spoken = await synthesizeSpeech({
    config,
    text,
    whatsapp: false,
    languageHint,
    ...(config.voiceProvider === 'sarvam' ? {} : { modelId: LIVE_AI_TTS_MODEL }),
  })
  return {
    audioBase64: Buffer.from(spoken.bytes).toString('base64'),
    mimeType: spoken.mimeType,
  }
}
