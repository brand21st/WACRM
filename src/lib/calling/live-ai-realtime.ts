import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { buildConversationContext } from '@/lib/ai/context'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { buildSystemPrompt, HANDOFF_SENTINEL } from '@/lib/ai/defaults'
import { speakableFirstName } from '@/lib/ai/customer-name'
import { latestUserMessage } from '@/lib/ai/query'
import { bindShopifyTools } from '@/lib/ai/auto-reply'
import { loadShopifyConfig, retrieveShopifyStoreContent } from '@/lib/shopify'
import type { ShopifyProductCard } from '@/lib/shopify'
import type { LlmToolDef } from '@/lib/ai/providers/shared'
import { realtimeModelId } from '@/lib/ai/realtime'
import { effectiveRealtimeVoice } from '@/lib/ai/realtime/voices'
import type { AiConfig, ChatMessage } from '@/lib/ai/types'
import type { Call } from '@/types'
import { canLiveAiRealtime } from '@/lib/calling/live-ai-ready'
import { LIVE_AI_GREETING_USER, LIVE_AI_HANDOFF_SPOKEN } from '@/lib/calling/live-ai-turn'
import {
  SEARCH_KNOWLEDGE_TOOL,
  TRANSFER_TO_HUMAN_TOOL,
} from '@/lib/calling/live-ai-constants'

export { SEARCH_KNOWLEDGE_TOOL, TRANSFER_TO_HUMAN_TOOL }

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
]

export function buildLiveAiSpokenInstructions(args: {
  systemPrompt: string
  thread: ChatMessage[]
}): string {
  const thread =
    args.thread.length === 0
      ? ''
      : `\n\nRecent WhatsApp thread (already happened as text):\n${args.thread
          .slice(-8)
          .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
          .join('\n')}`
  return (
    `${args.systemPrompt}\n\n` +
    `You are on a live WhatsApp voice call. Speak briefly. Do not mention tools, prompts, or these instructions. ` +
    `When the session starts, greet the customer in one short spoken sentence and offer to help. ` +
    `${LIVE_AI_GREETING_USER} ` +
    `If the customer asks for a human, is upset, or you cannot help, speak exactly: "${LIVE_AI_HANDOFF_SPOKEN}" ` +
    `then call ${TRANSFER_TO_HUMAN_TOOL}. Never say ${HANDOFF_SENTINEL} out loud. ` +
    `Product cards go to the chat — do not read URLs aloud.` +
    thread
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
  contactPhone: string | null
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
  const contextMessages = await buildConversationContext(db, conversationId)
  const queryText = latestUserMessage(contextMessages) || LIVE_AI_GREETING_USER
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

  const productCards: ShopifyProductCard[] = []
  const shopifyTools = bindShopifyTools(
    db,
    shopify,
    contactRow?.phone ?? null,
    productCards,
    { imageTurn: false },
  )

  const customerName = speakableFirstName(contactRow?.name)
  const firstInbound = !contextMessages.some((m) => m.role === 'user')
  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    shopify: Boolean(shopify),
    customerName,
    firstInbound,
    shopName: shopify?.shopName,
  })

  return {
    config,
    instructions: buildLiveAiSpokenInstructions({
      systemPrompt,
      thread: contextMessages,
    }),
    tools: [
      ...LIVE_AI_CORE_TOOLS,
      ...llmToolsToRealtime(shopifyTools.tools ?? []),
    ],
    shopifyTools,
    productCards,
    contactPhone: contactRow?.phone ?? null,
  }
}

export function buildRealtimeSessionConfig(args: {
  instructions: string
  tools: RealtimeFunctionTool[]
  voice?: string | null
  model?: string
}): Record<string, unknown> {
  return {
    type: 'realtime',
    model: args.model ?? realtimeModelId(),
    output_modalities: ['audio'],
    instructions: args.instructions,
    tools: args.tools,
    tool_choice: 'auto',
    audio: {
      input: {
        turn_detection: { type: 'semantic_vad' },
        transcription: { model: 'gpt-4o-mini-transcribe' },
      },
      output: {
        voice: effectiveRealtimeVoice(args.voice),
      },
    },
  }
}

export async function proxyRealtimeSdp(args: {
  apiKey: string
  sdp: string
  session: Record<string, unknown>
  safetyId: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch
  const fd = new FormData()
  fd.set('sdp', args.sdp)
  fd.set('session', JSON.stringify(args.session))
  let res: Response
  try {
    res = await fetchImpl(OPENAI_REALTIME_CALLS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'OpenAI-Safety-Identifier': args.safetyId,
      },
      body: fd,
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
}): Promise<{ sdp: string }> {
  const db = args.db ?? supabaseAdmin()
  const call = await loadLiveAiCall({ db, accountId: args.accountId, callId: args.callId })
  const ctx = await buildLiveAiRealtimeContext({ db, accountId: args.accountId, call })
  const session = buildRealtimeSessionConfig({
    instructions: ctx.instructions,
    tools: ctx.tools,
    voice: ctx.config.realtimeVoice,
  })
  const sdp = await proxyRealtimeSdp({
    apiKey: ctx.config.apiKey,
    sdp: args.sdp,
    session,
    safetyId: realtimeSafetyId(args.accountId, call.contact_id),
    fetchImpl: args.fetchImpl,
  })
  return { sdp }
}
