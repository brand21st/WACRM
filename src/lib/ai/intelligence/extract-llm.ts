/**
 * Learning-only structured LLM boundary. This intentionally bypasses
 * generateReply and every customer-facing prompt/rewrite/tool path.
 */

import type { AiConfig, AiUsage, ChatMessage, ProviderResult } from '@/lib/ai/types'
import { aiRequestTimeoutMs } from '@/lib/ai/defaults'
import { generateOpenAi } from '@/lib/ai/providers/openai'
import { generateAnthropic } from '@/lib/ai/providers/anthropic'
import {
  extractJsonArray,
  parseLlmSalesEvents,
} from './sales-event-schema'
import type { CandidateSalesEvent } from './extract-deterministic'
import type { AnalyzerMessage } from './extract-deterministic'

export const LLM_SYSTEM_PROMPT = `You extract structured sales events from a WhatsApp shopping conversation.
Return ONLY a JSON array. Each item is {"type": string, "confidence": number, "metadata": object}.

Allowed types:
CUSTOMER_INTENT, HESITATION, OBJECTION, DISCOUNT_REQUEST, SHIPPING_INQUIRY,
RETURN_INQUIRY, REFUND_INQUIRY, PAYMENT_INQUIRY, NEEDS_MORE_INFORMATION,
HIGH_INTENT, INTERESTED, TRUST_CONCERN

Rules:
- confidence is 0 to 1
- metadata keys only: productId, variantId, budgetMax, color, size, category, objectionType
- no raw quotes, names, phones, emails, or payment details
- skip greetings and "ok" / "nice" / "looks good" unless they clearly show buying intent
- if nothing qualifies, return []`

export interface LlmExtractInput {
  turns: AnalyzerMessage[]
  config: AiConfig
  generateStructured?: typeof generateLearningStructuredOutput
}

export interface LlmExtractResult {
  events: CandidateSalesEvent[]
  usage: AiUsage | null
  status: 'success' | 'provider_error' | 'invalid_output'
}

export async function extractLlmEvents(
  input: LlmExtractInput,
): Promise<LlmExtractResult> {
  const generate = input.generateStructured ?? generateLearningStructuredOutput
  const messages = toChatTurns(input.turns)
  if (messages.length === 0) {
    return { events: [], usage: null, status: 'success' }
  }

  let text = ''
  let usage: AiUsage | null = null
  try {
    const result = await generate({
      config: input.config,
      systemPrompt: LLM_SYSTEM_PROMPT,
      messages,
    })
    text = result.text ?? ''
    usage = result.usage
  } catch (err) {
    console.error(
      '[conversation-intelligence] LLM extract failed:',
      err instanceof Error ? err.message : err,
    )
    return { events: [], usage: null, status: 'provider_error' }
  }

  const json = extractJsonArray(text)
  if (json == null) {
    console.warn('[conversation-intelligence] LLM extract returned invalid JSON')
    return { events: [], usage, status: 'invalid_output' }
  }

  const parsed = parseLlmSalesEvents(json)
  if (!parsed.success) {
    console.warn('[conversation-intelligence] LLM extract schema failed:', parsed.error)
    return { events: [], usage, status: 'invalid_output' }
  }
  if (Array.isArray(json) && json.length > 0 && parsed.data.length === 0) {
    console.warn('[conversation-intelligence] LLM extract returned no valid items')
    return { events: [], usage, status: 'invalid_output' }
  }

  const lastCustomer = [...input.turns]
    .reverse()
    .find((turn) => turn.sender_type === 'customer')

  return {
    events: parsed.data.map((draft) => ({
      eventType: draft.type,
      kind: 'signal' as const,
      confidence: draft.confidence,
      metadata: draft.metadata,
      sourceMessageId: lastCustomer?.id ?? null,
      sourceTable: lastCustomer ? 'messages' : 'llm',
      sourceId: lastCustomer ? lastCustomer.id : 'llm',
    })),
    usage,
    status: 'success',
  }
}

export async function generateLearningStructuredOutput(args: {
  config: AiConfig
  systemPrompt: string
  messages: ChatMessage[]
}): Promise<ProviderResult> {
  const providerArgs = {
    apiKey: args.config.apiKey,
    model: args.config.model,
    systemPrompt: args.systemPrompt,
    messages: args.messages,
    timeoutMs: aiRequestTimeoutMs(),
    maxTokens: 300,
  }
  if (args.config.provider === 'openai') return generateOpenAi(providerArgs)
  if (args.config.provider === 'anthropic') return generateAnthropic(providerArgs)
  throw new Error(`Unsupported learning provider: ${args.config.provider}`)
}

function toChatTurns(turns: AnalyzerMessage[]): ChatMessage[] {
  return turns
    .map((turn) => {
      const content = (turn.content_text ?? '').trim()
      if (!content) return null
      return {
        role: turn.sender_type === 'customer' ? 'user' : 'assistant',
        content: `${turn.id} ${turn.sender_type}: ${content}`.slice(0, 500),
      } satisfies ChatMessage
    })
    .filter((row): row is ChatMessage => row != null)
    .slice(-8)
}
