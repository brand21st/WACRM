/**
 * Phase 2 contracts for tenant-scoped Business Knowledge Intelligence.
 *
 * Application-level only. No category column, no new tables, no learning.
 *
 * @see docs/ai-intelligence/16-business-knowledge.md
 */

export const KNOWLEDGE_CATEGORIES = [
  'PRODUCT',
  'PRICING',
  'DISCOUNT',
  'SHIPPING',
  'DELIVERY',
  'RETURN',
  'REFUND',
  'EXCHANGE',
  'PAYMENT',
  'ORDER',
  'BUSINESS_INFO',
  'CONTACT',
  'POLICY',
  'FAQ',
  'SALES',
  'MARKETING',
  'OTHER',
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

/** Policy-like categories that can produce numeric conflicts. */
export const POLICY_CONFLICT_CATEGORIES = [
  'RETURN',
  'REFUND',
  'EXCHANGE',
  'SHIPPING',
  'DELIVERY',
  'PAYMENT',
  'DISCOUNT',
] as const satisfies readonly KnowledgeCategory[];

export type PolicyConflictCategory = (typeof POLICY_CONFLICT_CATEGORIES)[number];

export const KNOWLEDGE_SOURCES = [
  'manual_kb',
  'catalog',
  'store_policy',
  'url_kb',
  'store_page',
  'generic_model',
] as const;

export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

export type KnowledgeConfidence = 'high' | 'medium' | 'low' | 'unknown';

export interface KnowledgeQuery {
  accountId: string;
  query: string;
  category?: KnowledgeCategory;
  /** Accepted for future orchestration. Phase 2 does not load customer memory. */
  contactId?: string;
  limit?: number;
}

export interface KnowledgeRef {
  documentId?: string;
  chunkId?: string;
  handle?: string;
  productId?: string;
}

export interface KnowledgeResult {
  id: string;
  source: KnowledgeSource;
  category: KnowledgeCategory;
  confidence: KnowledgeConfidence;
  excerpt: string;
  ref: KnowledgeRef;
  updatedAt?: string | null;
}

export interface KnowledgeConflict {
  category: KnowledgeCategory;
  tokens: [string, string];
  resultIds: [string, string];
  unresolved: boolean;
  winnerId?: string;
}

export interface BusinessKnowledgeSnapshot {
  accountId: string;
  contactId?: string;
  query: string;
  results: KnowledgeResult[];
  conflicts: KnowledgeConflict[];
  catalogProductIds: string[];
  fetchedAt: string;
}

export function emptyBusinessKnowledgeSnapshot(
  accountId: string,
  query = '',
  contactId?: string
): BusinessKnowledgeSnapshot {
  return {
    accountId,
    contactId,
    query,
    results: [],
    conflicts: [],
    catalogProductIds: [],
    fetchedAt: new Date(0).toISOString(),
  };
}
