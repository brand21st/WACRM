/**
 * Optional structured LLM pass for Phase 3. At most one generateReply
 * per job. Does not call retrieveBusinessKnowledge.
 */

import type { AiConfig, ChatMessage } from '@/lib/ai/types'
import { generateReply } from '@/lib/ai/generate'
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
  generateReplyFn?: typeof generateReply
}

export async function extractLlmEvents(
  input: LlmExtractInput,
): Promise<CandidateSalesEvent[]> {
  const generate = input.generateReplyFn ?? generateReply
  const messages = toChatTurns(input.turns)
  if (messages.length === 0) return []

  let text = ''
  try {
    const result = await generate({
      config: input.config,
      systemPrompt: LLM_SYSTEM_PROMPT,
      messages,
      skipSpokenRewrite: true,
    })
    text = result.text ?? ''
  } catch (err) {
    console.error(
      '[conversation-intelligence] LLM extract failed:',
      err instanceof Error ? err.message : err,
    )
    return []
  }

  const json = extractJsonArray(text)
  if (json == null) {
    console.warn('[conversation-intelligence] LLM extract returned invalid JSON')
    return []
  }

  const parsed = parseLlmSalesEvents(json)
  if (!parsed.success) {
    console.warn('[conversation-intelligence] LLM extract schema failed:', parsed.error)
    return []
  }

  const lastCustomer = [...input.turns]
    .reverse()
    .find((turn) => turn.sender_type === 'customer')

  return parsed.data.map((draft) => ({
    eventType: draft.type,
    kind: 'signal' as const,
    confidence: draft.confidence,
    metadata: draft.metadata,
    sourceMessageId: lastCustomer?.id ?? null,
    sourceTable: lastCustomer ? 'messages' : 'llm',
    sourceId: lastCustomer ? lastCustomer.id : 'llm',
  }))
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
