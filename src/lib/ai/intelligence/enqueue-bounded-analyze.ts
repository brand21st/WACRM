/**
 * Session-scoped bounded analyze enqueue.
 * Uses the existing conversation analyzer queue only.
 * Does not run unless an admin route invokes it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { isRedisConfigured } from '@/lib/queue/redis'
import {
  enqueueAiConversationAnalyze,
} from '@/lib/queue/enqueue'
import { aiConversationAnalyzeJob } from '@/lib/queue/jobs'
import { requireAccountId } from './contracts'
import {
  isMissingDbColumn,
  isMissingDbRelation,
} from '@/lib/shopify/config-db'

export const BOUNDED_ANALYZE_DAYS = 7
export const BOUNDED_ANALYZE_MAX_WINDOW_DAYS = 90
export const BOUNDED_ANALYZE_MAX_CONVERSATIONS = 100
export const BOUNDED_ANALYZE_DEFAULT_BATCH = 10
export const BOUNDED_ANALYZE_STAGGER_MS = 250
export const ANALYZE_RECENT_CONFIRMATION = 'ANALYZE RECENT CONVERSATIONS'

const HYBRID_INPUT_TOKENS_PER_PAGE = 1500
const HYBRID_OUTPUT_TOKENS_PER_PAGE = 200
const GPT54_MINI_INPUT_USD_PER_MILLION = 0.75
const GPT54_MINI_OUTPUT_USD_PER_MILLION = 4.5

export type BoundedAnalyzeTarget = {
  conversationId: string
  contactId: string | null
  triggeringMessageId: string
}

export type BoundedAnalyzeResult = {
  considered: number
  queued: number
  skipped: number
  queue_unavailable: boolean
  window_days: number
  max_conversations: number
}

export type BoundedAnalyzePreview = {
  available: boolean
  window_days: number
  max_conversations: number
  eligible_conversations: number
  selected_conversations: number
  eligible_turns: number
  minimum_analyzer_pages: number
  first_eligible_at: string | null
  last_eligible_at: string | null
  commerce_order_count: number
  completed_order_count: number
  canceled_order_count: number
  background_learning_mode: 'off' | 'deterministic' | 'hybrid' | 'unknown'
  estimated_llm_calls: number
  estimated_input_tokens: number
  estimated_output_tokens: number
  estimated_cost_usd: number
  analyze_queue_configured: boolean
}

type PendingAnalyzeRow = {
  account_id: string
  conversation_id: string
  contact_id: string | null
  triggering_message_id: string | null
  pending_trigger: unknown
}

type DueConversationRow = {
  conversation_id: string
  contact_id: string | null
  triggering_message_id: string
}

type PreviewRow = {
  window_days: number
  max_conversations: number
  eligible_conversations: number
  selected_conversations: number
  eligible_turns: number | string
  minimum_analyzer_pages: number | string
  first_eligible_at: string | null
  last_eligible_at: string | null
  commerce_order_count: number
  completed_order_count: number
  canceled_order_count: number
}

export function clampAnalyzeWindowDays(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return BOUNDED_ANALYZE_DAYS
  return Math.min(
    BOUNDED_ANALYZE_MAX_WINDOW_DAYS,
    Math.max(1, Math.floor(parsed)),
  )
}

export function clampAnalyzeBatchSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return BOUNDED_ANALYZE_DEFAULT_BATCH
  return Math.min(
    BOUNDED_ANALYZE_MAX_CONVERSATIONS,
    Math.max(1, Math.floor(parsed)),
  )
}

export async function listBoundedAnalyzeTargets(
  db: SupabaseClient,
  accountId: string,
  options: { windowDays?: number; maxConversations?: number } = {},
): Promise<BoundedAnalyzeTarget[]> {
  const id = requireAccountId(accountId, 'listBoundedAnalyzeTargets')
  const windowDays = clampAnalyzeWindowDays(
    options.windowDays ?? BOUNDED_ANALYZE_DAYS,
  )
  const maxConversations = clampAnalyzeBatchSize(
    options.maxConversations ?? BOUNDED_ANALYZE_DEFAULT_BATCH,
  )
  const { data, error } = await db.rpc('list_conversations_due_for_analysis', {
    p_account_id: id,
    p_limit: maxConversations,
    p_window_days: windowDays,
  })
  if (error) throw error
  return ((data ?? []) as DueConversationRow[]).map((row) => ({
    conversationId: row.conversation_id,
    contactId: row.contact_id,
    triggeringMessageId: row.triggering_message_id,
  }))
}

export async function previewBoundedConversationAnalyze(
  db: SupabaseClient,
  accountId: string,
  options: { windowDays?: number; maxConversations?: number } = {},
): Promise<BoundedAnalyzePreview> {
  const id = requireAccountId(accountId, 'previewBoundedConversationAnalyze')
  const windowDays = clampAnalyzeWindowDays(
    options.windowDays ?? BOUNDED_ANALYZE_DAYS,
  )
  const maxConversations = clampAnalyzeBatchSize(
    options.maxConversations ?? BOUNDED_ANALYZE_DEFAULT_BATCH,
  )
  const unavailable: BoundedAnalyzePreview = {
    available: false,
    window_days: windowDays,
    max_conversations: maxConversations,
    eligible_conversations: 0,
    selected_conversations: 0,
    eligible_turns: 0,
    minimum_analyzer_pages: 0,
    first_eligible_at: null,
    last_eligible_at: null,
    commerce_order_count: 0,
    completed_order_count: 0,
    canceled_order_count: 0,
    background_learning_mode: 'unknown',
    estimated_llm_calls: 0,
    estimated_input_tokens: 0,
    estimated_output_tokens: 0,
    estimated_cost_usd: 0,
    analyze_queue_configured: isRedisConfigured(),
  }

  const [{ data, error }, mode] = await Promise.all([
    db.rpc('preview_conversation_analysis_backfill', {
      p_account_id: id,
      p_window_days: windowDays,
      p_limit: maxConversations,
    }),
    loadBackgroundMode(db, id),
  ])
  if (
    isMissingPreviewFunction(error) ||
    isMissingDbRelation(error, 'conversation_analysis_cursors')
  ) {
    return { ...unavailable, background_learning_mode: mode }
  }
  if (error) throw error
  const row = Array.isArray(data) ? (data[0] as PreviewRow | undefined) : (data as PreviewRow | null)
  if (!row) return { ...unavailable, available: true, background_learning_mode: mode }

  const pages = Number(row.minimum_analyzer_pages ?? 0)
  const hybrid = mode === 'hybrid'
  const estimatedLlmCalls = hybrid ? pages : 0
  const estimatedInputTokens = estimatedLlmCalls * HYBRID_INPUT_TOKENS_PER_PAGE
  const estimatedOutputTokens = estimatedLlmCalls * HYBRID_OUTPUT_TOKENS_PER_PAGE
  return {
    available: true,
    window_days: Number(row.window_days ?? windowDays),
    max_conversations: Number(row.max_conversations ?? maxConversations),
    eligible_conversations: Number(row.eligible_conversations ?? 0),
    selected_conversations: Number(row.selected_conversations ?? 0),
    eligible_turns: Number(row.eligible_turns ?? 0),
    minimum_analyzer_pages: pages,
    first_eligible_at: row.first_eligible_at ?? null,
    last_eligible_at: row.last_eligible_at ?? null,
    commerce_order_count: Number(row.commerce_order_count ?? 0),
    completed_order_count: Number(row.completed_order_count ?? 0),
    canceled_order_count: Number(row.canceled_order_count ?? 0),
    background_learning_mode: mode,
    estimated_llm_calls: estimatedLlmCalls,
    estimated_input_tokens: estimatedInputTokens,
    estimated_output_tokens: estimatedOutputTokens,
    estimated_cost_usd: Number(
      (
        (estimatedInputTokens / 1_000_000) * GPT54_MINI_INPUT_USD_PER_MILLION +
        (estimatedOutputTokens / 1_000_000) * GPT54_MINI_OUTPUT_USD_PER_MILLION
      ).toFixed(4),
    ),
    analyze_queue_configured: isRedisConfigured(),
  }
}

export async function enqueueBoundedConversationAnalyze(
  db: SupabaseClient,
  accountId: string,
  deps: {
    listTargets?: typeof listBoundedAnalyzeTargets
    enqueue?: typeof enqueueAiConversationAnalyze
    staggerMs?: number
    windowDays?: number
    maxConversations?: number
  } = {},
): Promise<BoundedAnalyzeResult> {
  const id = requireAccountId(accountId, 'enqueueBoundedConversationAnalyze')
  const windowDays = clampAnalyzeWindowDays(
    deps.windowDays ?? BOUNDED_ANALYZE_DAYS,
  )
  const maxConversations = clampAnalyzeBatchSize(
    deps.maxConversations ?? BOUNDED_ANALYZE_DEFAULT_BATCH,
  )
  const list = deps.listTargets ?? listBoundedAnalyzeTargets
  const enqueue = deps.enqueue ?? enqueueAiConversationAnalyze
  const staggerMs = deps.staggerMs ?? BOUNDED_ANALYZE_STAGGER_MS
  const targets = await list(db, id, { windowDays, maxConversations })

  let queued = 0
  let skipped = 0
  let queueUnavailable = false
  for (const [index, target] of targets.entries()) {
    const job = aiConversationAnalyzeJob({
      accountId: id,
      conversationId: target.conversationId,
      contactId: target.contactId,
      trigger: { type: 'message', messageId: target.triggeringMessageId },
    })
    const delayMs = index * staggerMs
    const ok = await enqueue(job, delayMs)
    if (ok) queued += 1
    else {
      skipped += 1
      queueUnavailable = true
    }
  }

  return {
    considered: targets.length,
    queued,
    skipped,
    queue_unavailable: queueUnavailable && queued === 0,
    window_days: windowDays,
    max_conversations: maxConversations,
  }
}

export async function reconcilePendingConversationAnalysis(
  db: SupabaseClient,
  opts: {
    limit?: number
    enqueue?: typeof enqueueAiConversationAnalyze
  } = {},
): Promise<BoundedAnalyzeResult> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 100)
  const { data, error } = await db.rpc('list_pending_conversation_analysis', {
    p_limit: limit,
  })
  if (error) throw error
  const rows = (data ?? []) as PendingAnalyzeRow[]
  const enqueue = opts.enqueue ?? enqueueAiConversationAnalyze
  let queued = 0
  for (const [index, row] of rows.entries()) {
    const trigger = parsePendingTrigger(row.pending_trigger, row.triggering_message_id)
    if (!trigger) continue
    const ok = await enqueue(
      aiConversationAnalyzeJob({
        accountId: row.account_id,
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        trigger,
      }),
      index * BOUNDED_ANALYZE_STAGGER_MS,
    )
    if (ok) queued += 1
  }
  return {
    considered: rows.length,
    queued,
    skipped: rows.length - queued,
    queue_unavailable: rows.length > 0 && queued === 0,
    window_days: BOUNDED_ANALYZE_DAYS,
    max_conversations: limit,
  }
}

async function loadBackgroundMode(
  db: SupabaseClient,
  accountId: string,
): Promise<BoundedAnalyzePreview['background_learning_mode']> {
  const { data, error } = await db
    .from('ai_configs')
    .select('background_learning_mode')
    .eq('account_id', accountId)
    .maybeSingle()
  if (
    isMissingDbRelation(error, 'ai_configs') ||
    isMissingDbColumn(error, 'background_learning_mode')
  ) {
    return 'unknown'
  }
  if (error) throw error
  const mode = data?.background_learning_mode
  return mode === 'deterministic' || mode === 'hybrid' || mode === 'off'
    ? mode
    : 'off'
}

function isMissingPreviewFunction(error: { message?: string } | null): boolean {
  return Boolean(
    error?.message &&
      /preview_conversation_analysis_backfill|function .* does not exist/i.test(
        error.message,
      ),
  )
}

function parsePendingTrigger(
  value: unknown,
  fallbackMessageId: string | null,
):
  | { type: 'message'; messageId: string }
  | { type: 'commerce'; sourceId: string }
  | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>
    if (row.type === 'message' && typeof row.messageId === 'string') {
      return { type: 'message', messageId: row.messageId }
    }
    if (row.type === 'commerce' && typeof row.sourceId === 'string') {
      return { type: 'commerce', sourceId: row.sourceId }
    }
  }
  return fallbackMessageId
    ? { type: 'message', messageId: fallbackMessageId }
    : null
}
