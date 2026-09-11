/**
 * Phase 1 contracts for tenant-scoped AI intelligence.
 *
 * Types and helpers only. No analyzer, no pattern writer, no tables.
 * Future phases implement against these shapes without changing the
 * live auto-reply path.
 *
 * @see docs/ai-intelligence/README.md
 */

import type {
  SalesEventKind,
  SalesEventMetadata,
  SalesEventV1Type,
} from './sales-event-types';

export type { SalesEventKind, SalesEventMetadata, SalesEventV1Type };
export type { SalesEventV1Type as SalesEventType };

export class MissingAccountIdError extends Error {
  constructor(context = 'intelligence query') {
    super(`${context} requires accountId`);
    this.name = 'MissingAccountIdError';
  }
}

/** Throw when a retrieve / write would run without a tenant key. */
export function requireAccountId(
  accountId: string | null | undefined,
  context?: string
): string {
  const id = typeof accountId === 'string' ? accountId.trim() : '';
  if (!id) throw new MissingAccountIdError(context);
  return id;
}

export type IntelligenceLayer =
  | 'business_knowledge'
  | 'catalog'
  | 'customer_memory'
  | 'conversation'
  | 'sales_pattern';

export interface RetrievalQuery {
  /** Required. First filter at the storage boundary — never applied after a global search. */
  accountId: string;
  layer: IntelligenceLayer;
  contactId?: string;
  conversationId?: string;
  query?: string;
}

export function assertRetrievalQuery(query: RetrievalQuery): RetrievalQuery {
  requireAccountId(query.accountId, `retrieve ${query.layer}`);
  return query;
}

export interface ConversationAnalyzeJob {
  accountId: string;
  conversationId: string;
  contactId: string | null;
  trigger:
    | { type: 'message'; messageId: string }
    | { type: 'commerce'; sourceId: string };
  /** Unique execution identity; coalescing is handled separately by BullMQ. */
  runId: string;
  idempotencyKey: string;
}

export function analyzeJobIdempotencyKey(args: {
  accountId: string;
  conversationId: string;
  trigger: ConversationAnalyzeJob['trigger'];
}): string {
  const accountId = requireAccountId(args.accountId, 'ConversationAnalyzeJob');
  const source =
    args.trigger.type === 'message'
      ? args.trigger.messageId
      : args.trigger.sourceId;
  return `${accountId}:${args.conversationId}:${args.trigger.type}:${source}`;
}

export interface SalesEvent {
  accountId: string;
  conversationId: string;
  /** Contact UUID only — no phone / email / name. */
  contactId: string;
  sourceMessageId?: string;
  type: SalesEventV1Type;
  kind: SalesEventKind;
  confidence: number;
  /** Structured signal. Do not store raw message paragraphs or PII. */
  metadata: SalesEventMetadata;
  analyzerVersion: string;
}

export interface SalesPattern {
  /** Never null, never a global/industry row in v1. */
  accountId: string;
  patternType: string;
  sourceContext: string;
  confidence: number;
  evidenceCount: number;
  outcomeMetrics: Record<string, number>;
  /** True when status is `active`. */
  active: boolean;
  version: number;
  patternKey?: string;
  status?: 'candidate' | 'active' | 'stale' | 'archived';
}

export type OutcomeKind =
  | 'response_generated'
  | 'response_delivered'
  | 'customer_replied'
  | 'product_shown'
  | 'product_selected'
  | 'add_to_cart'
  | 'checkout_started'
  | 'purchase_completed'
  | 'rejected_product'
  | 'human_takeover'
  | 'stopped_responding';

export interface OutcomeRef {
  accountId: string;
  kind: OutcomeKind;
  sourceTable: string;
  sourceId: string;
}

/** Existing tables Phase 6 can map onto OutcomeKind. Not new analytics. */
export const EXISTING_OUTCOME_SOURCES = [
  {
    kind: 'response_generated',
    sourceTable: 'messages',
    note: 'bot + ai_generated',
  },
  {
    kind: 'response_delivered',
    sourceTable: 'messages',
    note: 'status sent/delivered',
  },
  {
    kind: 'customer_replied',
    sourceTable: 'messages',
    note: 'inbound after bot',
  },
  {
    kind: 'product_shown',
    sourceTable: 'catalog_product_events',
    note: 'event=shown',
  },
  {
    kind: 'add_to_cart',
    sourceTable: 'catalog_product_events',
    note: 'event=add_to_cart',
  },
  {
    kind: 'checkout_started',
    sourceTable: 'whatsapp_commerce_orders',
    note: 'status=pending',
  },
  {
    kind: 'purchase_completed',
    sourceTable: 'whatsapp_commerce_orders',
    note: 'paid / completed',
  },
  {
    kind: 'human_takeover',
    sourceTable: 'conversations',
    note: 'ai_autoreply_disabled',
  },
] as const satisfies ReadonlyArray<{
  kind: OutcomeKind;
  sourceTable: string;
  note: string;
}>;
