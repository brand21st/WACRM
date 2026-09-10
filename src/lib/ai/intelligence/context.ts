/**
 * Thin AI context composer for future orchestration.
 *
 * Wraps existing tenant-scoped loaders. Not wired into
 * `dispatchInboundToAiReply` — live auto-reply stays as-is until Phase 5.
 *
 * `salesPatterns` stays empty unless the caller injects already-retrieved
 * patterns. This composer does not query `sales_patterns`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  emptyContactMemory,
  formatCustomerMemoryBlock,
  loadContactMemory,
  type ContactMemory,
} from '@/lib/ai/chat-memory';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { latestUserMessage } from '@/lib/ai/query';
import type { AiConfig, ChatMessage } from '@/lib/ai/types';
import {
  emptyShoppingContext,
  formatSalesSnapshot,
  loadShoppingContext,
} from '@/lib/catalog/intelligence/shopping-context';
import type { ShoppingContext } from '@/lib/catalog/intelligence/types';
import { retrieveShopifyStoreContent } from '@/lib/shopify/store-content';
import { requireAccountId, type SalesPattern } from './contracts';
import {
  emptyBusinessKnowledgeSnapshot,
  type BusinessKnowledgeSnapshot,
} from './knowledge-contracts';
import {
  retrieveBusinessKnowledge,
  type RetrieveBusinessKnowledgeDeps,
} from './knowledge-context';

export interface BuildAIContextArgs {
  accountId: string;
  contactId: string;
  conversationId: string;
  /** Latest customer text. When omitted, taken from conversation history. */
  message?: string;
}

export interface AIContext {
  accountId: string;
  contactId: string;
  conversationId: string;
  message: string;
  messages: ChatMessage[];
  memory: ContactMemory;
  customerMemoryBlock: string;
  shopping: ShoppingContext;
  salesSnapshot: string;
  knowledge: string[];
  /** Phase 2 business-knowledge snapshot. Unused by live auto-reply. */
  businessKnowledge: BusinessKnowledgeSnapshot;
  /** Empty unless the caller injects already-retrieved patterns. */
  salesPatterns: SalesPattern[];
}

export type BuildAIContextDeps = {
  loadAiConfig?: (
    db: SupabaseClient,
    accountId: string,
    opts?: { requireActive?: boolean }
  ) => Promise<AiConfig | null>;
  buildConversationContext?: (
    db: SupabaseClient,
    conversationId: string
  ) => Promise<ChatMessage[]>;
  loadContactMemory?: (
    db: SupabaseClient,
    accountId: string,
    contactId: string
  ) => Promise<ContactMemory>;
  loadShoppingContext?: (
    db: SupabaseClient,
    accountId: string,
    contactId: string | null | undefined
  ) => Promise<ShoppingContext>;
  retrieveKnowledge?: (
    db: SupabaseClient,
    accountId: string,
    config: Pick<AiConfig, 'embeddingsApiKey'>,
    queryText: string
  ) => Promise<string[]>;
  retrieveShopifyStoreContent?: (
    db: SupabaseClient,
    accountId: string,
    queryText: string,
    k?: number
  ) => Promise<string[]>;
  retrieveBusinessKnowledge?: typeof retrieveBusinessKnowledge;
  businessKnowledgeDeps?: RetrieveBusinessKnowledgeDeps;
  /** Already-retrieved patterns. The composer never queries sales_patterns. */
  salesPatterns?: SalesPattern[];
};

function emptySlice<T>(fallback: T): T {
  return fallback;
}

/**
 * Assemble tenant-scoped context for one customer turn.
 * Throws only when `accountId` is missing. Loader failures become empty slices.
 */
export async function buildAIContext(
  db: SupabaseClient,
  args: BuildAIContextArgs,
  deps: BuildAIContextDeps = {}
): Promise<AIContext> {
  const accountId = requireAccountId(args.accountId, 'buildAIContext');
  const contactId = args.contactId;
  const conversationId = args.conversationId;

  const loadConfig = deps.loadAiConfig ?? loadAiConfig;
  const loadMessages =
    deps.buildConversationContext ?? buildConversationContext;
  const loadMemory = deps.loadContactMemory ?? loadContactMemory;
  const loadShopping = deps.loadShoppingContext ?? loadShoppingContext;
  const loadKnowledge = deps.retrieveKnowledge ?? retrieveKnowledge;
  const loadStore =
    deps.retrieveShopifyStoreContent ?? retrieveShopifyStoreContent;

  const [config, messages, memory, shopping] = await Promise.all([
    loadConfig(db, accountId, { requireActive: false }).catch(() => null),
    loadMessages(db, conversationId).catch(() => [] as ChatMessage[]),
    loadMemory(db, accountId, contactId).catch(() => emptyContactMemory()),
    loadShopping(db, accountId, contactId).catch(() => emptyShoppingContext()),
  ]);

  const message = (args.message ?? latestUserMessage(messages)).trim();
  const retrieveText = message;

  const loadBusiness =
    deps.retrieveBusinessKnowledge ?? retrieveBusinessKnowledge;

  const [manualKnowledge, storeContent, businessKnowledge] = await Promise.all([
    loadKnowledge(
      db,
      accountId,
      { embeddingsApiKey: config?.embeddingsApiKey ?? null },
      retrieveText
    ).catch(() => [] as string[]),
    loadStore(db, accountId, retrieveText, 5).catch(() => [] as string[]),
    loadBusiness(
      db,
      { accountId, contactId, query: retrieveText },
      deps.businessKnowledgeDeps
    ).catch(() => emptyBusinessKnowledgeSnapshot(accountId, retrieveText, contactId)),
  ]);

  const knowledge = [...storeContent, ...manualKnowledge].slice(0, 8);

  return {
    accountId,
    contactId,
    conversationId,
    message,
    messages,
    memory,
    customerMemoryBlock: formatCustomerMemoryBlock(memory),
    shopping,
    salesSnapshot: formatSalesSnapshot(shopping),
    knowledge,
    businessKnowledge,
    salesPatterns: deps.salesPatterns
      ? deps.salesPatterns.slice()
      : emptySlice<SalesPattern[]>([]),
  };
}
