/**
 * Phase 3 conversation analyzer. Runs on the BullMQ worker — never on
 * the live WhatsApp reply path.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAiConfig } from '@/lib/ai/config';
import { logAiUsage } from '@/lib/ai/usage';
import { loadShoppingContext } from '@/lib/catalog/intelligence/shopping-context';
import type { AiConfig } from '@/lib/ai/types';
import type { ShoppingContext } from '@/lib/catalog/intelligence/types';
import { requireAccountId, type ConversationAnalyzeJob } from './contracts';
import {
  extractDeterministicEvents,
  shouldSkipLlm,
  type AbandonedCheckoutRow,
  type AnalyzerMessage,
  type CandidateSalesEvent,
  type CatalogProductEventRow,
  type CommerceOrderRow,
  type StoredSalesEventRef,
} from './extract-deterministic';
import { extractLlmEvents } from './extract-llm';
import { observeSalesPatternsInBackground } from './observe-sales-patterns';
import {
  applyOwnedCatalogMetadata,
  loadOwnedCatalogRefs,
} from './owned-catalog-refs';
import { toSalesEventInsertRow } from './sales-event-schema';
import { ANALYZER_VERSION } from './sales-event-types';

const CONTEXT_TURNS = 8;
const NEW_TURN_CAP = 20;

export type BackgroundLearningMode = 'off' | 'deterministic' | 'hybrid';
export interface BackgroundLearningControls {
  mode: BackgroundLearningMode;
  paused: boolean;
  dailyConversationLimit: number;
  dailyTokenLimit: number;
}

export type AnalysisErrorCode =
  | 'analysis_failed'
  | 'llm_provider_error'
  | 'llm_invalid_output'
  | 'llm_config_unavailable'
  | 'llm_budget_deferred';

export interface AnalyzeConversationResult {
  wrote: number;
  skipped: boolean;
  reason?: string;
}

export interface AnalyzeConversationDeps {
  loadConversation?: typeof loadConversation;
  deferOrDismiss?: typeof deferOrDismissAnalysis;
  beginCursor?: typeof setCursorRunning;
  loadControls?: typeof loadBackgroundLearningControls;
  loadDailyUsage?: typeof loadDailyLearningUsage;
  deferBudget?: typeof deferAnalysisForDailyBudget;
  loadCursor?: typeof loadCursor;
  loadMessages?: typeof loadMessages;
  loadCommerceOrders?: typeof loadCommerceOrders;
  loadCatalogEvents?: typeof loadCatalogEvents;
  loadAbandonedCheckouts?: typeof loadAbandonedCheckouts;
  loadContactPaid?: typeof loadContactPaid;
  loadExistingEvents?: typeof loadExistingEvents;
  loadShopping?: typeof loadShoppingContext;
  insertEvents?: typeof insertSalesEvents;
  loadOwnedRefs?: typeof loadOwnedCatalogRefs;
  upsertCursor?: typeof upsertAnalysisCursor;
  loadAiConfig?: typeof loadAiConfig;
  extractLlm?: typeof extractLlmEvents;
  logUsage?: typeof logAiUsage;
  observePatterns?: typeof observeSalesPatternsInBackground;
}

export async function analyzeConversation(
  db: SupabaseClient,
  job: ConversationAnalyzeJob,
  deps: AnalyzeConversationDeps = {}
): Promise<AnalyzeConversationResult> {
  const accountId = requireAccountId(job.accountId, 'analyzeConversation');
  if (!job.conversationId?.trim()) {
    throw new Error('analyzeConversation requires conversationId');
  }

  const loadConv = deps.loadConversation ?? loadConversation;
  const conversation = await loadConv(db, accountId, job.conversationId);
  if (!conversation) {
    return { wrote: 0, skipped: true, reason: 'conversation_not_found' };
  }

  const controls = await (deps.loadControls ?? loadBackgroundLearningControls)(
    db,
    accountId
  );
  if (controls.mode === 'off' || controls.paused) {
    await (deps.deferOrDismiss ?? deferOrDismissAnalysis)(
      db,
      accountId,
      conversation.id,
      controls.paused
    );
    return {
      wrote: 0,
      skipped: true,
      reason: controls.paused ? 'learning_paused' : 'learning_off',
    };
  }
  const dailyUsage = await (deps.loadDailyUsage ?? loadDailyLearningUsage)(
    db,
    accountId
  );
  if (dailyUsage.conversations >= controls.dailyConversationLimit) {
    await (deps.deferBudget ?? deferAnalysisForDailyBudget)(
      db,
      accountId,
      conversation.id
    );
    return { wrote: 0, skipped: true, reason: 'daily_conversation_budget' };
  }

  const loadCur = deps.loadCursor ?? loadCursor;
  const cursor = await loadCur(db, accountId, conversation.id);
  await (deps.beginCursor ?? setCursorRunning)(db, {
    accountId,
    conversationId: conversation.id,
    pendingMessageId:
      job.trigger.type === 'message' ? job.trigger.messageId : null,
    pendingTrigger: job.trigger,
  });
  const loadMsgs = deps.loadMessages ?? loadMessages;
  const deterministicWindow = await loadMsgs(
    db,
    accountId,
    conversation.id,
    cursor?.last_source_created_at ?? null,
    cursor?.last_source_message_id ?? null
  );

  const { unprocessed } = splitAnalysisWindow(
    deterministicWindow,
    cursor?.last_source_message_id ?? null,
    cursor?.last_source_created_at ?? null
  );
  const llmWindow =
    controls.mode === 'hybrid'
      ? await loadMsgs(
          db,
          accountId,
          conversation.id,
          cursor?.last_llm_source_created_at ?? null,
          cursor?.last_llm_source_message_id ?? null
        )
      : deterministicWindow;
  const llmDelta = splitAnalysisWindow(
    llmWindow,
    cursor?.last_llm_source_message_id ?? null,
    cursor?.last_llm_source_created_at ?? null
  );

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
      conversation.contact_id ?? job.contactId
    ),
    (deps.loadCatalogEvents ?? loadCatalogEvents)(
      db,
      accountId,
      conversation.id
    ),
    (deps.loadAbandonedCheckouts ?? loadAbandonedCheckouts)(
      db,
      accountId,
      conversation.id,
      conversation.contact_id ?? job.contactId
    ),
    (deps.loadContactPaid ?? loadContactPaid)(
      db,
      accountId,
      conversation.contact_id ?? job.contactId
    ),
    (deps.loadExistingEvents ?? loadExistingEvents)(
      db,
      accountId,
      conversation.id
    ),
    (deps.loadShopping ?? loadShoppingContext)(
      db,
      accountId,
      conversation.contact_id ?? job.contactId
    ).catch(() => null),
  ]);

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
  });

  let llmEvents: CandidateSalesEvent[] = [];
  let advanceLlm = controls.mode === 'deterministic';
  let retryLlm = false;
  let llmErrorCode: AnalysisErrorCode | null = null;

  if (controls.mode === 'hybrid') {
    const llmDeterministic = extractDeterministicEvents({
      accountId,
      conversationId: conversation.id,
      contactId: conversation.contact_id ?? job.contactId,
      newMessages: llmDelta.unprocessed,
      commerceOrders,
      catalogEvents,
      abandonedCheckouts,
      shopping: shopping as ShoppingContext | null,
      existingEvents,
      humanTakeover: Boolean(conversation.ai_autoreply_disabled),
      shopifyPaidAt: contactPaid?.shopify_paid_at ?? null,
      waCommercePaidAt: contactPaid?.wa_commerce_paid_at ?? null,
    });
    const uncertain =
      llmDeterministic.length === 0 ||
      Math.max(...llmDeterministic.map((event) => event.confidence)) < 0.8;
    const shouldAttempt =
      uncertain &&
      !shouldSkipLlm({
        newMessages: llmDelta.unprocessed,
        deterministic: llmDeterministic,
      });

    if (!shouldAttempt) {
      advanceLlm = true;
    } else if (dailyUsage.tokens >= controls.dailyTokenLimit) {
      retryLlm = true;
      llmErrorCode = 'llm_budget_deferred';
    } else {
      const config = await (deps.loadAiConfig ?? loadAiConfig)(
        db,
        accountId
      ).catch((err) => {
        console.error('[conversation-intelligence] loadAiConfig failed:', err);
        return null;
      });
      if (!config) {
        retryLlm = true;
        llmErrorCode = 'llm_config_unavailable';
      } else {
        const extractLlm = deps.extractLlm ?? extractLlmEvents;
        const extracted = await extractLlm({
          turns: [...llmDelta.context, ...llmDelta.unprocessed].slice(
            -CONTEXT_TURNS
          ),
          config: config as AiConfig,
        }).catch((err) => {
          console.error('[conversation-intelligence] LLM extract threw:', err);
          return {
            events: [],
            usage: null,
            status: 'provider_error' as const,
          };
        });
        await (deps.logUsage ?? logAiUsage)(db, {
          accountId,
          conversationId: conversation.id,
          mode: 'conversation_analysis',
          purpose: 'structured_sales_event_extraction',
          analyzerVersion: ANALYZER_VERSION,
          provider: config.provider,
          model: config.model,
          usage: extracted.usage,
        });
        if (extracted.status === 'success') {
          llmEvents = extracted.events;
          advanceLlm = true;
        } else {
          retryLlm = true;
          llmErrorCode =
            extracted.status === 'invalid_output'
              ? 'llm_invalid_output'
              : 'llm_provider_error';
        }
      }
    }
  }

  const candidates = [...deterministic, ...llmEvents];
  const owned = await (deps.loadOwnedRefs ?? loadOwnedCatalogRefs)(db, accountId, {
    productIds: candidates.flatMap((event) =>
      event.metadata.productId ? [event.metadata.productId] : []
    ),
    variantIds: candidates.flatMap((event) =>
      event.metadata.variantId ? [event.metadata.variantId] : []
    ),
  });
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
      metadata: applyOwnedCatalogMetadata(event.metadata, owned),
    })
  );

  const insert = deps.insertEvents ?? insertSalesEvents;
  const wrote = rows.length ? await insert(db, rows) : 0;

  await (deps.observePatterns ?? observeSalesPatternsInBackground)(db, {
    accountId,
    turns: unprocessed,
    shopping: shopping as ShoppingContext | null,
    productId:
      (shopping as ShoppingContext | null)?.selectedIds?.[0] ??
      (shopping as ShoppingContext | null)?.shownIds?.[0] ??
      null,
  });

  const deterministicWatermark = processedWatermark(
    unprocessed,
    cursor?.last_source_message_id ?? null,
    cursor?.last_source_created_at ?? null
  );
  const llmWatermark =
    controls.mode === 'deterministic'
      ? deterministicWatermark
      : processedWatermark(
          llmDelta.unprocessed,
          cursor?.last_llm_source_message_id ?? null,
          cursor?.last_llm_source_created_at ?? null
        );

  const saveCursor = deps.upsertCursor ?? upsertAnalysisCursor;
  await saveCursor(db, {
    accountId,
    conversationId: conversation.id,
    deterministicMessageId: deterministicWatermark.messageId,
    deterministicCreatedAt: deterministicWatermark.createdAt,
    llmMessageId: llmWatermark.messageId,
    llmCreatedAt: llmWatermark.createdAt,
    advanceLlm,
    retryLlm,
    completedTrigger: job.trigger,
    errorCode: llmErrorCode,
  });

  return { wrote, skipped: false };
}

export async function deferAnalysisForDailyBudget(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 5, 0, 0);
  const { error } = await db
    .from('conversation_analysis_cursors')
    .update({
      status: 'pending',
      next_attempt_at: tomorrow.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId);
  if (error) throw error;
}

export async function deferOrDismissAnalysis(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  paused: boolean
): Promise<void> {
  const now = new Date();
  const patch = paused
    ? {
        status: 'pending',
        next_attempt_at: new Date(now.getTime() + 15 * 60_000).toISOString(),
        updated_at: now.toISOString(),
      }
    : {
        status: 'idle',
        pending_source_message_id: null,
        pending_source_created_at: null,
        pending_trigger: null,
        next_attempt_at: null,
        updated_at: now.toISOString(),
      };
  const { error } = await db
    .from('conversation_analysis_cursors')
    .update(patch)
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId);
  if (error) throw error;
}

export function splitAnalysisWindow(
  messages: AnalyzerMessage[],
  lastSourceMessageId: string | null,
  lastSourceCreatedAt: string | null = null
): { context: AnalyzerMessage[]; unprocessed: AnalyzerMessage[] } {
  const ordered = [...messages].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
  let start = 0;
  if (lastSourceMessageId) {
    const idx = ordered.findIndex((row) => row.id === lastSourceMessageId);
    if (idx >= 0) {
      start = idx + 1;
    } else if (lastSourceCreatedAt) {
      start = ordered.findIndex(
        (row) =>
          row.created_at > lastSourceCreatedAt ||
          (row.created_at === lastSourceCreatedAt &&
            row.id > lastSourceMessageId)
      );
      if (start < 0) start = ordered.length;
    }
  }
  const afterCursor = ordered.slice(start);
  const unprocessed = afterCursor
    .filter((row) => isExtractableMessage(row))
    .slice(0, NEW_TURN_CAP);
  const context = ordered.slice(Math.max(0, start - CONTEXT_TURNS), start);
  return { context, unprocessed };
}

function isExtractableMessage(message: AnalyzerMessage): boolean {
  if (message.sender_type !== 'customer') return false;
  return (
    message.content_type === 'order' ||
    message.content_type === 'interactive' ||
    Boolean((message.content_text ?? '').trim()) ||
    Boolean(message.interactive_reply_id)
  );
}

function processedWatermark(
  unprocessed: AnalyzerMessage[],
  previousMessageId: string | null,
  previousCreatedAt: string | null
): { messageId: string | null; createdAt: string | null } {
  const latest = unprocessed[unprocessed.length - 1];
  return latest
    ? { messageId: latest.id, createdAt: latest.created_at }
    : { messageId: previousMessageId, createdAt: previousCreatedAt };
}

interface ConversationRow {
  id: string;
  contact_id: string | null;
  ai_autoreply_disabled?: boolean | null;
}

interface CursorRow {
  last_source_message_id: string | null;
  last_source_created_at: string | null;
  last_llm_source_message_id: string | null;
  last_llm_source_created_at: string | null;
}

export async function loadConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ConversationRow | null> {
  const { data, error } = await db
    .from('conversations')
    .select('id, contact_id, ai_autoreply_disabled')
    .eq('account_id', accountId)
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return (data as ConversationRow | null) ?? null;
}

export async function loadCursor(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<CursorRow | null> {
  const { data, error } = await db
    .from('conversation_analysis_cursors')
    .select(
      'last_source_message_id, last_source_created_at, last_llm_source_message_id, last_llm_source_created_at'
    )
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return (data as CursorRow | null) ?? null;
}

export async function loadMessages(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  lastCreatedAt: string | null,
  lastMessageId: string | null
): Promise<AnalyzerMessage[]> {
  const columns =
    'id, sender_type, content_type, content_text, interactive_reply_id, interactive_payload, created_at, conversations!inner(account_id)';
  let deltaQuery = db
    .from('messages')
    .select(columns)
    .eq('conversations.account_id', accountId)
    .eq('conversation_id', conversationId);
  if (lastCreatedAt) deltaQuery = deltaQuery.gte('created_at', lastCreatedAt);
  const { data: deltaData, error: deltaError } = await deltaQuery
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(NEW_TURN_CAP + 1);
  if (deltaError) throw deltaError;

  const delta = ((deltaData ?? []) as unknown as AnalyzerMessage[])
    .filter(
      (row) =>
        !lastCreatedAt ||
        row.created_at > lastCreatedAt ||
        (row.created_at === lastCreatedAt && row.id > (lastMessageId ?? ''))
    )
    .slice(0, NEW_TURN_CAP);

  let contextQuery = db
    .from('messages')
    .select(columns)
    .eq('conversations.account_id', accountId)
    .eq('conversation_id', conversationId);
  if (lastCreatedAt)
    contextQuery = contextQuery.lte('created_at', lastCreatedAt);
  const { data: contextData, error: contextError } = await contextQuery
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CONTEXT_TURNS);
  if (contextError) throw contextError;
  const context = (
    (contextData ?? []) as unknown as AnalyzerMessage[]
  ).reverse();
  const byId = new Map([...context, ...delta].map((row) => [row.id, row]));
  return [...byId.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  );
}

export async function loadCommerceOrders(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId?: string | null
): Promise<CommerceOrderRow[]> {
  let query = db
    .from('whatsapp_commerce_orders')
    .select('id, status, conversation_id, contact_id, line_items')
    .eq('account_id', accountId);
  if (contactId) {
    query = query.or(
      `conversation_id.eq.${conversationId},contact_id.eq.${contactId}`
    );
  } else {
    query = query.eq('conversation_id', conversationId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as CommerceOrderRow[]) ?? [];
}

export async function loadCatalogEvents(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<CatalogProductEventRow[]> {
  const { data, error } = await db
    .from('catalog_product_events')
    .select('id, event, product_id, variant_id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .in('event', ['add_to_cart', 'purchase']);
  if (error) throw error;
  return (data as CatalogProductEventRow[]) ?? [];
}

export async function loadAbandonedCheckouts(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  contactId?: string | null
): Promise<AbandonedCheckoutRow[]> {
  const { data, error } = await db
    .from('shopify_notification_jobs')
    .select('id, trigger_key, resource_id, payload')
    .eq('account_id', accountId)
    .eq('trigger_key', 'checkout_abandoned');
  if (error) throw error;
  const rows = (data as AbandonedCheckoutRow[]) ?? [];
  return rows.filter((row) => {
    const payload =
      row.payload && typeof row.payload === 'object'
        ? (row.payload as Record<string, unknown>)
        : null;
    const conv =
      typeof payload?.conversation_id === 'string'
        ? payload.conversation_id
        : typeof payload?.conversationId === 'string'
          ? payload.conversationId
          : null;
    if (conv) return conv === conversationId;
    const contact =
      typeof payload?.contact_id === 'string'
        ? payload.contact_id
        : typeof payload?.contactId === 'string'
          ? payload.contactId
          : null;
    return Boolean(contactId && contact === contactId);
  });
}

export async function loadContactPaid(
  db: SupabaseClient,
  accountId: string,
  contactId?: string | null
): Promise<{
  shopify_paid_at: string | null;
  wa_commerce_paid_at: string | null;
} | null> {
  if (!contactId) return null;
  const { data, error } = await db
    .from('contacts')
    .select('shopify_paid_at, wa_commerce_paid_at')
    .eq('account_id', accountId)
    .eq('id', contactId)
    .maybeSingle();
  if (error) throw error;
  return data as {
    shopify_paid_at: string | null;
    wa_commerce_paid_at: string | null;
  } | null;
}

export async function loadExistingEvents(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<StoredSalesEventRef[]> {
  const { data, error } = await db
    .from('sales_events')
    .select('event_type, metadata, source_id, source_table, source_message_id')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId);
  if (error) throw error;
  return (data as StoredSalesEventRef[]) ?? [];
}

export async function insertSalesEvents(
  db: SupabaseClient,
  rows: ReturnType<typeof toSalesEventInsertRow>[]
): Promise<number> {
  if (!rows.length) return 0;
  const { error } = await db.from('sales_events').insert(rows);
  if (!error) return rows.length;
  if (error.code !== '23505') throw error;
  let wrote = 0;
  for (const row of rows) {
    const { error: one } = await db.from('sales_events').insert(row);
    if (!one) wrote += 1;
    else if (one.code !== '23505') throw one;
  }
  return wrote;
}

export async function upsertAnalysisCursor(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    deterministicMessageId: string | null;
    deterministicCreatedAt: string | null;
    llmMessageId: string | null;
    llmCreatedAt: string | null;
    advanceLlm: boolean;
    retryLlm: boolean;
    completedTrigger: ConversationAnalyzeJob['trigger'];
    errorCode: AnalysisErrorCode | null;
  }
): Promise<void> {
  const { error } = await db.rpc('complete_conversation_analysis', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_deterministic_message_id: args.deterministicMessageId,
    p_deterministic_created_at: args.deterministicCreatedAt,
    p_llm_message_id: args.llmMessageId,
    p_llm_created_at: args.llmCreatedAt,
    p_advance_llm: args.advanceLlm,
    p_retry_llm: args.retryLlm,
    p_completed_trigger: args.completedTrigger,
    p_error_code: args.errorCode,
    p_analyzer_version: ANALYZER_VERSION,
  });
  if (error) throw error;
}

export async function loadBackgroundLearningControls(
  db: SupabaseClient,
  accountId: string
): Promise<BackgroundLearningControls> {
  const { data, error } = await db
    .from('ai_configs')
    .select(
      'background_learning_mode, background_learning_paused, background_learning_daily_conversation_limit, background_learning_daily_token_limit'
    )
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  const row = data as Record<string, unknown> | null;
  const mode = row?.background_learning_mode;
  return {
    mode: mode === 'deterministic' || mode === 'hybrid' ? mode : 'off',
    paused: row?.background_learning_paused === true,
    dailyConversationLimit: Number(
      row?.background_learning_daily_conversation_limit ?? 100
    ),
    dailyTokenLimit: Number(
      row?.background_learning_daily_token_limit ?? 25000
    ),
  };
}

export async function loadDailyLearningUsage(
  db: SupabaseClient,
  accountId: string
): Promise<{ conversations: number; tokens: number }> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [analysisResult, tokenResult] = await Promise.all([
    db
      .from('conversation_analysis_cursors')
      .select('conversation_id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .gte('last_analyzed_at', since.toISOString()),
    db
      .from('ai_usage_log')
      .select('total_tokens')
      .eq('account_id', accountId)
      .eq('mode', 'conversation_analysis')
      .gte('created_at', since.toISOString()),
  ]);
  if (analysisResult.error) throw analysisResult.error;
  if (tokenResult.error) throw tokenResult.error;
  return {
    conversations: analysisResult.count ?? 0,
    tokens: (
      (tokenResult.data ?? []) as Array<{ total_tokens: number }>
    ).reduce((sum, row) => sum + Number(row.total_tokens || 0), 0),
  };
}

export async function setCursorRunning(
  db: SupabaseClient,
  args: {
    accountId: string;
    conversationId: string;
    pendingMessageId: string | null;
    pendingTrigger: ConversationAnalyzeJob['trigger'];
  }
): Promise<void> {
  const { error } = await db.rpc('start_conversation_analysis', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
    p_pending_message_id: args.pendingMessageId,
    p_pending_trigger: args.pendingTrigger,
  });
  if (error) throw error;
}

export async function markAnalysisFailed(
  db: SupabaseClient,
  job: ConversationAnalyzeJob,
  error: unknown
): Promise<void> {
  void error;
  const now = new Date();
  const { error: writeError } = await db
    .from('conversation_analysis_cursors')
    .update({
      status: 'failed',
      last_error: 'analysis_failed',
      next_attempt_at: new Date(now.getTime() + 5 * 60_000).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('account_id', job.accountId)
    .eq('conversation_id', job.conversationId);
  if (writeError)
    console.error('[conversation-intelligence] persist failure:', writeError);
}
