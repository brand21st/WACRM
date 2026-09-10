/**
 * Phase 3 conversation analyzer. Runs on the BullMQ worker — never on
 * the live WhatsApp reply path.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import { loadShoppingContext } from '@/lib/catalog/intelligence/shopping-context'
import type { AiConfig } from '@/lib/ai/types'
import type { ShoppingContext } from '@/lib/catalog/intelligence/types'
import { requireAccountId, type ConversationAnalyzeJob } from './contracts'
import {
  extractDeterministicEvents,
  shouldSkipLlm,
  type AbandonedCheckoutRow,
  type AnalyzerMessage,
  type CandidateSalesEvent,
  type CatalogProductEventRow,
  type CommerceOrderRow,
  type StoredSalesEventRef,
} from './extract-deterministic'
import { extractLlmEvents } from './extract-llm'
import { toSalesEventInsertRow } from './sales-event-schema'
import { ANALYZER_VERSION } from './sales-event-types'

const CONTEXT_TURNS = 8
const NEW_TURN_CAP = 20
const MESSAGE_WINDOW = CONTEXT_TURNS + NEW_TURN_CAP

export interface AnalyzeConversationResult {
  wrote: number
  skipped: boolean
  reason?: string
}

export interface AnalyzeConversationDeps {
  loadConversation?: typeof loadConversation
  loadCursor?: typeof loadCursor
  loadMessages?: typeof loadMessages
  loadCommerceOrders?: typeof loadCommerceOrders
  loadCatalogEvents?: typeof loadCatalogEvents
  loadAbandonedCheckouts?: typeof loadAbandonedCheckouts
  loadContactPaid?: typeof loadContactPaid
  loadExistingEvents?: typeof loadExistingEvents
  loadShopping?: typeof loadShoppingContext
  insertEvents?: typeof insertSalesEvents
  upsertCursor?: typeof upsertAnalysisCursor
  loadAiConfig?: typeof loadAiConfig
  generateReply?: typeof generateReply
  extractLlm?: typeof extractLlmEvents
}

export async function analyzeConversation(
  db: SupabaseClient,
  job: ConversationAnalyzeJob,
  deps: AnalyzeConversationDeps = {},
): Promise<AnalyzeConversationResult> {
  const accountId = requireAccountId(job.accountId, 'analyzeConversation')
  if (!job.conversationId?.trim()) {
    throw new Error('analyzeConversation requires conversationId')
  }

  const loadConv = deps.loadConversation ?? loadConversation
  const conversation = await loadConv(db, accountId, job.conversationId)
  if (!conversation) {
    return { wrote: 0, skipped: true, reason: 'conversation_not_found' }
  }

  const loadCur = deps.loadCursor ?? loadCursor
  const loadMsgs = deps.loadMessages ?? loadMessages
  const [cursor, window] = await Promise.all([
    loadCur(db, accountId, conversation.id),
    loadMsgs(db, conversation.id),
  ])

  const { context, unprocessed } = splitAnalysisWindow(
    window,
    cursor?.last_source_message_id ?? null,
  )

  const [
    commerceOrders,
    catalogEvents,
    abandonedCheckouts,
    contactPaid,
    existingEvents,
    shopping,
  ] = await Promise.all([
    (deps.loadCommerceOrders ?? loadCommerceOrders)(
      db,
      accountId,
      conversation.id,
      conversation.contact_id ?? job.contactId,
    ),
    (deps.loadCatalogEvents ?? loadCatalogEvents)(db, accountId, conversation.id),
    (deps.loadAbandonedCheckouts ?? loadAbandonedCheckouts)(
      db,
      accountId,
      conversation.id,
      conversation.contact_id ?? job.contactId,
    ),
    (deps.loadContactPaid ?? loadContactPaid)(
      db,
      accountId,
      conversation.contact_id ?? job.contactId,
    ),
    (deps.loadExistingEvents ?? loadExistingEvents)(db, accountId, conversation.id),
    (deps.loadShopping ?? loadShoppingContext)(
      db,
      accountId,
      conversation.contact_id ?? job.contactId,
    ).catch(() => null),
  ])

  const deterministic = extractDeterministicEvents({
    accountId,
    conversationId: conversation.id,
    contactId: conversation.contact_id ?? job.contactId,
    newMessages: unprocessed,
    commerceOrders,
    catalogEvents,
    abandonedCheckouts,
    shopping: shopping as ShoppingContext | null,
    existingEvents,
    humanTakeover: Boolean(conversation.ai_autoreply_disabled),
    shopifyPaidAt: contactPaid?.shopify_paid_at ?? null,
    waCommercePaidAt: contactPaid?.wa_commerce_paid_at ?? null,
  })

  let llmEvents: CandidateSalesEvent[] = []
  if (!shouldSkipLlm({ newMessages: unprocessed, deterministic })) {
    const config = await (deps.loadAiConfig ?? loadAiConfig)(db, accountId).catch(
      (err) => {
        console.error('[conversation-intelligence] loadAiConfig failed:', err)
        return null
      },
    )
    if (config) {
      const extractLlm = deps.extractLlm ?? extractLlmEvents
      llmEvents = await extractLlm({
        turns: [...context, ...unprocessed].slice(-CONTEXT_TURNS),
        config: config as AiConfig,
        generateReplyFn: deps.generateReply,
      }).catch((err) => {
        console.error('[conversation-intelligence] LLM extract threw:', err)
        return []
      })
    }
  }

  const candidates = [...deterministic, ...llmEvents]
  const rows = candidates.map((event) =>
    toSalesEventInsertRow({
      accountId,
      conversationId: conversation.id,
      contactId: conversation.contact_id ?? job.contactId,
      sourceMessageId: event.sourceMessageId,
      sourceTable: event.sourceTable,
      sourceId: event.sourceId,
      eventType: event.eventType,
      kind: event.kind,
      confidence: event.confidence,
      metadata: event.metadata,
    }),
  )

  const insert = deps.insertEvents ?? insertSalesEvents
  const wrote = rows.length ? await insert(db, rows) : 0

  const cursorMessageId =
    job.triggeringMessageId &&
    window.some((message) => message.id === job.triggeringMessageId)
      ? job.triggeringMessageId
      : latestProcessedId(unprocessed, window)

  const saveCursor = deps.upsertCursor ?? upsertAnalysisCursor
  await saveCursor(db, {
    accountId,
    conversationId: conversation.id,
    lastSourceMessageId: cursorMessageId,
  })

  return { wrote, skipped: false }
}

export function splitAnalysisWindow(
  messages: AnalyzerMessage[],
  lastSourceMessageId: string | null,
): { context: AnalyzerMessage[]; unprocessed: AnalyzerMessage[] } {
  const ordered = [...messages].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  )
  let start = 0
  if (lastSourceMessageId) {
    const idx = ordered.findIndex((row) => row.id === lastSourceMessageId)
    if (idx >= 0) start = idx + 1
  }
  const afterCursor = ordered.slice(start)
  const unprocessed = afterCursor
    .filter((row) => isExtractableMessage(row))
    .slice(0, NEW_TURN_CAP)
  const context = ordered.slice(Math.max(0, ordered.length - CONTEXT_TURNS))
  return { context, unprocessed }
}

function isExtractableMessage(message: AnalyzerMessage): boolean {
  if (message.sender_type !== 'customer') return false
  return (
    message.content_type === 'order' ||
    message.content_type === 'interactive' ||
    Boolean((message.content_text ?? '').trim()) ||
    Boolean(message.interactive_reply_id)
  )
}

function latestProcessedId(
  unprocessed: AnalyzerMessage[],
  window: AnalyzerMessage[],
): string | null {
  if (unprocessed.length) return unprocessed[unprocessed.length - 1].id
  if (window.length) return window[window.length - 1].id
  return null
}

interface ConversationRow {
  id: string
  contact_id: string | null
  ai_autoreply_disabled?: boolean | null
}

interface CursorRow {
  last_source_message_id: string | null
}

export async function loadConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id, contact_id, ai_autoreply_disabled')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return (data as ConversationRow | null) ?? null
}

export async function loadCursor(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<CursorRow | null> {
  const { data, error } = await db
    .from('conversation_analysis_cursors')
    .select('last_source_message_id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) throw error
  return (data as CursorRow | null) ?? null
}

export async function loadMessages(
  db: SupabaseClient,
  conversationId: string,
): Promise<AnalyzerMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select(
      'id, sender_type, content_type, content_text, interactive_reply_id, interactive_payload, created_at',
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_WINDOW)
  if (error) throw error
  return ((data as AnalyzerMessage[]) ?? []).reverse()
}

export async function loadCommerceOrders(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId?: string | null,
): Promise<CommerceOrderRow[]> {
  let query = db
    .from('whatsapp_commerce_orders')
    .select('id, status, conversation_id, contact_id, line_items')
    .eq('account_id', accountId)
  if (contactId) {
    query = query.or(`conversation_id.eq.${conversationId},contact_id.eq.${contactId}`)
  } else {
    query = query.eq('conversation_id', conversationId)
  }
  const { data, error } = await query
  if (error) throw error
  return (data as CommerceOrderRow[]) ?? []
}

export async function loadCatalogEvents(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<CatalogProductEventRow[]> {
  const { data, error } = await db
    .from('catalog_product_events')
    .select('id, event, product_id, variant_id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .in('event', ['add_to_cart', 'purchase'])
  if (error) throw error
  return (data as CatalogProductEventRow[]) ?? []
}

export async function loadAbandonedCheckouts(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId?: string | null,
): Promise<AbandonedCheckoutRow[]> {
  const { data, error } = await db
    .from('shopify_notification_jobs')
    .select('id, trigger_key, resource_id, payload')
    .eq('account_id', accountId)
    .eq('trigger_key', 'checkout_abandoned')
  if (error) throw error
  const rows = (data as AbandonedCheckoutRow[]) ?? []
  return rows.filter((row) => {
    const payload = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : null
    const conv =
      typeof payload?.conversation_id === 'string'
        ? payload.conversation_id
        : typeof payload?.conversationId === 'string'
          ? payload.conversationId
          : null
    if (conv) return conv === conversationId
    const contact =
      typeof payload?.contact_id === 'string'
        ? payload.contact_id
        : typeof payload?.contactId === 'string'
          ? payload.contactId
          : null
    return Boolean(contactId && contact === contactId)
  })
}

export async function loadContactPaid(
  db: SupabaseClient,
  accountId: string,
  contactId?: string | null,
): Promise<{ shopify_paid_at: string | null; wa_commerce_paid_at: string | null } | null> {
  if (!contactId) return null
  const { data, error } = await db
    .from('contacts')
    .select('shopify_paid_at, wa_commerce_paid_at')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle()
  if (error) throw error
  return data as {
    shopify_paid_at: string | null
    wa_commerce_paid_at: string | null
  } | null
}

export async function loadExistingEvents(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<StoredSalesEventRef[]> {
  const { data, error } = await db
    .from('sales_events')
    .select('event_type, metadata, source_id, source_table, source_message_id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
  if (error) throw error
  return (data as StoredSalesEventRef[]) ?? []
}

export async function insertSalesEvents(
  db: SupabaseClient,
  rows: ReturnType<typeof toSalesEventInsertRow>[],
): Promise<number> {
  if (!rows.length) return 0
  const { error } = await db.from('sales_events').insert(rows)
  if (!error) return rows.length
  if (error.code !== '23505') throw error
  let wrote = 0
  for (const row of rows) {
    const { error: one } = await db.from('sales_events').insert(row)
    if (!one) wrote += 1
    else if (one.code !== '23505') throw one
  }
  return wrote
}

export async function upsertAnalysisCursor(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    lastSourceMessageId: string | null
  },
): Promise<void> {
  const { error } = await db.from('conversation_analysis_cursors').upsert(
    {
      account_id: args.accountId,
      conversation_id: args.conversationId,
      last_source_message_id: args.lastSourceMessageId,
      last_analyzed_at: new Date().toISOString(),
      analyzer_version: ANALYZER_VERSION,
    },
    { onConflict: 'account_id,conversation_id' },
  )
  if (error) throw error
}
