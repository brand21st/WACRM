/**
 * Zod-shaped parse of Phase 3 LLM JSON and insert-row sanitization.
 *
 * No raw transcript, phone, name, or payment credentials in metadata.
 */

import {
  ALLOWED_METADATA_KEYS,
  ANALYZER_VERSION,
  isLlmEventType,
  type LlmEventType,
  type SalesEventKind,
  type SalesEventMetadata,
  type SalesEventV1Type,
} from './sales-event-types'

export const LLM_MIN_CONFIDENCE = 0.5
export const TRUST_CONCERN_MIN_CONFIDENCE = 0.7

export interface LlmSalesEventDraft {
  type: LlmEventType
  confidence: number
  metadata: SalesEventMetadata
}

export interface SalesEventInsertRow {
  account_id: string
  conversation_id: string
  contact_id: string | null
  source_message_id: string | null
  source_table: string | null
  source_id: string | null
  event_type: SalesEventV1Type
  kind: SalesEventKind
  confidence: number
  metadata: SalesEventMetadata
  analyzer_version: string
}

export type SchemaParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: string }

export function clampConfidence(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

export function sanitizeMetadata(raw: unknown): SalesEventMetadata {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const input = raw as Record<string, unknown>
  const out: SalesEventMetadata = {}
  for (const key of ALLOWED_METADATA_KEYS) {
    const value = input[key]
    if (value == null) continue
    if (key === 'budgetMax') {
      const n = typeof value === 'number' ? value : Number(value)
      if (Number.isFinite(n) && n >= 0) out.budgetMax = n
      continue
    }
    if (typeof value === 'string') {
      const trimmed = value.trim().slice(0, 80)
      if (trimmed) out[key] = trimmed
    }
  }
  return out
}

export function toSalesEventInsertRow(args: {
  accountId: string
  conversationId: string
  contactId?: string | null
  sourceMessageId?: string | null
  sourceTable?: string | null
  sourceId?: string | null
  eventType: SalesEventV1Type
  kind: SalesEventKind
  confidence: number
  metadata?: SalesEventMetadata
}): SalesEventInsertRow {
  const confidence = clampConfidence(args.confidence) ?? 0
  return {
    account_id: args.accountId,
    conversation_id: args.conversationId,
    contact_id: args.contactId ?? null,
    source_message_id: args.sourceMessageId ?? null,
    source_table: args.sourceTable ?? null,
    source_id: args.sourceId ?? null,
    event_type: args.eventType,
    kind: args.kind,
    confidence,
    metadata: sanitizeMetadata(args.metadata ?? {}),
    analyzer_version: ANALYZER_VERSION,
  }
}

function parseOneLlmEvent(raw: unknown): LlmSalesEventDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const type = row.type ?? row.event_type
  if (!isLlmEventType(type)) return null
  const confidence = clampConfidence(row.confidence)
  if (confidence == null) return null
  if (confidence < LLM_MIN_CONFIDENCE) return null
  if (type === 'TRUST_CONCERN' && confidence < TRUST_CONCERN_MIN_CONFIDENCE) {
    return null
  }
  return {
    type,
    confidence,
    metadata: sanitizeMetadata(row.metadata),
  }
}

/** Zod-equivalent `safeParse` for an LLM JSON array of sales events. */
export function parseLlmSalesEvents(raw: unknown): SchemaParseResult<LlmSalesEventDraft[]> {
  if (!Array.isArray(raw)) {
    return { success: false, error: 'expected a JSON array of events' }
  }
  const events: LlmSalesEventDraft[] = []
  for (const item of raw) {
    const parsed = parseOneLlmEvent(item)
    if (parsed) events.push(parsed)
  }
  return { success: true, data: events }
}

export function extractJsonArray(raw: string): unknown {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = (fenced?.[1] ?? trimmed).trim()
  try {
    return JSON.parse(body)
  } catch {
    const start = body.indexOf('[')
    const end = body.lastIndexOf(']')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        return null
      }
    }
    return null
  }
}
