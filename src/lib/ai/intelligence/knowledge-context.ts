/**
 * Tenant-scoped Business Knowledge retrieval.
 *
 * Wraps existing KB RPCs, Shopify store-content search, and catalog
 * search. Not wired into live auto-reply.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAiConfig } from '@/lib/ai/config';
import { embedTexts, toVectorLiteral } from '@/lib/ai/embeddings';
import type { AiConfig } from '@/lib/ai/types';
import { searchCatalog } from '@/lib/catalog/search/query';
import type { CatalogProduct } from '@/lib/catalog/core/types';
import {
  searchStoreContent,
  type ShopifyStoreContentHit,
} from '@/lib/shopify/store-content';
import { requireAccountId } from './contracts';
import {
  emptyBusinessKnowledgeSnapshot,
  type BusinessKnowledgeSnapshot,
  type KnowledgeQuery,
  type KnowledgeResult,
  type KnowledgeSource,
} from './knowledge-contracts';
import {
  applyResolvedConflicts,
  classifyCategory,
  compareKnowledgeResults,
  detectKnowledgeConflicts,
  knowledgeConfidence,
  knowledgeResultId,
} from './knowledge-sources';

const EXCERPT_MAX = 400;
const DEFAULT_LIMIT = 8;
const CATALOG_LIMIT = 3;

export type KnowledgeDocumentHit = {
  chunkId: string;
  documentId: string;
  title: string;
  content: string;
  sourceType: 'manual' | 'url';
  updatedAt?: string | null;
};

export type KnowledgeCatalogHit = {
  id: string;
  accountId: string;
  title: string;
  priceMin?: number | null;
  currency?: string | null;
  inStock?: boolean;
};

export type RetrieveBusinessKnowledgeDeps = {
  loadAiConfig?: (
    db: SupabaseClient,
    accountId: string,
    opts?: { requireActive?: boolean }
  ) => Promise<AiConfig | null>;
  loadKnowledgeHits?: (
    db: SupabaseClient,
    accountId: string,
    query: string,
    limit: number,
    embeddingsApiKey: string | null
  ) => Promise<KnowledgeDocumentHit[]>;
  searchStoreContent?: (
    db: SupabaseClient,
    accountId: string,
    query: string,
    limit: number
  ) => Promise<ShopifyStoreContentHit[]>;
  searchCatalog?: (
    db: SupabaseClient,
    args: { accountId: string; text: string; limit: number }
  ) => Promise<KnowledgeCatalogHit[]>;
};

interface MatchRow {
  id: string;
  content: string;
}

function capExcerpt(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text.length <= EXCERPT_MAX) return text;
  return `${text.slice(0, EXCERPT_MAX - 1).trim()}…`;
}

function catalogExcerpt(hit: KnowledgeCatalogHit): string {
  const parts = [hit.title.trim()];
  if (hit.priceMin != null) {
    const currency = (hit.currency ?? 'INR').trim() || 'INR';
    parts.push(`${hit.priceMin} ${currency}`);
  }
  if (hit.inStock === true) parts.push('in stock');
  if (hit.inStock === false) parts.push('out of stock');
  return capExcerpt(parts.filter(Boolean).join(' — '));
}

function toCatalogHit(product: CatalogProduct): KnowledgeCatalogHit {
  return {
    id: product.id,
    accountId: product.accountId,
    title: product.title,
    priceMin: product.priceMin,
    currency: product.currency,
    inStock: product.variants.some((variant) => variant.available),
  };
}

async function defaultLoadKnowledgeHits(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit: number,
  embeddingsApiKey: string | null
): Promise<KnowledgeDocumentHit[]> {
  try {
    const { count, error: countErr } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId);
    if (countErr || !count) return [];
  } catch {
    return [];
  }

  const picked = new Map<string, string>();

  if (embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(embeddingsApiKey, [query]);
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: limit,
        });
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content);
        }
      }
    } catch (err) {
      console.error('[business-knowledge] semantic retrieve failed:', err);
    }
  }

  if (picked.size < limit) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: limit,
      });
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= limit) break;
          if (!picked.has(row.id)) picked.set(row.id, row.content);
        }
      }
    } catch (err) {
      console.error('[business-knowledge] lexical retrieve failed:', err);
    }
  }

  const chunkIds = Array.from(picked.keys());
  if (chunkIds.length === 0) return [];

  const { data: chunkRows, error: chunkErr } = await db
    .from('ai_knowledge_chunks')
    .select('id, document_id, content')
    .eq('account_id', accountId)
    .in('id', chunkIds);
  if (chunkErr || !chunkRows) return [];

  const docIds = [
    ...new Set(
      (chunkRows as { document_id?: string }[])
        .map((row) => row.document_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (docIds.length === 0) return [];

  const { data: docs, error: docErr } = await db
    .from('ai_knowledge_documents')
    .select('id, title, source_type, updated_at')
    .eq('account_id', accountId)
    .in('id', docIds);
  if (docErr || !docs) return [];

  const docById = new Map(
    (docs as Array<{
      id: string;
      title?: string;
      source_type?: string;
      updated_at?: string | null;
    }>).map((doc) => [doc.id, doc])
  );

  const hits: KnowledgeDocumentHit[] = [];
  for (const row of chunkRows as Array<{
    id: string;
    document_id: string;
    content?: string;
  }>) {
    const doc = docById.get(row.document_id);
    if (!doc) continue;
    const sourceType = doc.source_type === 'url' ? 'url' : 'manual';
    hits.push({
      chunkId: row.id,
      documentId: doc.id,
      title: doc.title ?? '',
      content: row.content || picked.get(row.id) || '',
      sourceType,
      updatedAt: doc.updated_at ?? null,
    });
  }
  return hits;
}

async function defaultSearchCatalog(
  db: SupabaseClient,
  args: { accountId: string; text: string; limit: number }
): Promise<KnowledgeCatalogHit[]> {
  const products = await searchCatalog(db, {
    accountId: args.accountId,
    text: args.text,
    limit: args.limit,
    status: 'active',
  });
  return products
    .filter((product) => product.accountId === args.accountId)
    .slice(0, args.limit)
    .map(toCatalogHit);
}

function resultFromDocument(hit: KnowledgeDocumentHit): KnowledgeResult {
  const source: KnowledgeSource = hit.sourceType === 'url' ? 'url_kb' : 'manual_kb';
  const excerpt = capExcerpt(hit.content);
  const category = classifyCategory(hit.title, excerpt);
  return {
    id: knowledgeResultId(source, { chunkId: hit.chunkId, documentId: hit.documentId }),
    source,
    category,
    confidence: knowledgeConfidence({ source, excerpt }),
    excerpt,
    ref: { documentId: hit.documentId, chunkId: hit.chunkId },
    updatedAt: hit.updatedAt ?? null,
  };
}

function resultFromStore(hit: ShopifyStoreContentHit): KnowledgeResult {
  const source: KnowledgeSource = hit.kind === 'policy' ? 'store_policy' : 'store_page';
  const excerpt = capExcerpt(hit.body);
  const category = classifyCategory(hit.title, excerpt);
  return {
    id: knowledgeResultId(source, { handle: hit.handle ?? hit.title }),
    source,
    category,
    confidence: knowledgeConfidence({ source, excerpt }),
    excerpt,
    ref: { handle: hit.handle ?? undefined },
  };
}

function resultFromCatalog(hit: KnowledgeCatalogHit): KnowledgeResult {
  const excerpt = catalogExcerpt(hit);
  const hasPriceOrStock = hit.priceMin != null || hit.inStock != null;
  const classified = classifyCategory(hit.title);
  return {
    id: knowledgeResultId('catalog', { productId: hit.id }),
    source: 'catalog',
    category: classified === 'OTHER' ? 'PRODUCT' : classified,
    confidence: knowledgeConfidence({
      source: 'catalog',
      excerpt,
      catalogHasPriceOrStock: hasPriceOrStock,
    }),
    excerpt,
    ref: { productId: hit.id },
  };
}

export function buildBusinessKnowledgeSnapshot(args: {
  accountId: string;
  query: string;
  contactId?: string;
  results: KnowledgeResult[];
  fetchedAt?: string;
}): BusinessKnowledgeSnapshot {
  const sorted = [...args.results].sort(compareKnowledgeResults);
  const conflicts = detectKnowledgeConflicts(sorted);
  const results = applyResolvedConflicts(sorted, conflicts);
  return {
    accountId: args.accountId,
    contactId: args.contactId,
    query: args.query,
    results,
    conflicts,
    catalogProductIds: results
      .filter((row) => row.source === 'catalog' && row.ref.productId)
      .map((row) => row.ref.productId as string),
    fetchedAt: args.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * Retrieve tenant-scoped business knowledge. Throws only when accountId
 * is missing. Source failures become empty slices.
 */
export async function retrieveBusinessKnowledge(
  db: SupabaseClient,
  query: KnowledgeQuery,
  deps: RetrieveBusinessKnowledgeDeps = {}
): Promise<BusinessKnowledgeSnapshot> {
  const accountId = requireAccountId(query.accountId, 'retrieveBusinessKnowledge');
  const text = query.query.trim();
  const limit = Math.min(20, Math.max(1, query.limit ?? DEFAULT_LIMIT));

  if (!text) {
    return {
      ...emptyBusinessKnowledgeSnapshot(accountId, '', query.contactId),
      fetchedAt: new Date().toISOString(),
    };
  }

  const loadConfig = deps.loadAiConfig ?? loadAiConfig;
  const loadHits = deps.loadKnowledgeHits ?? defaultLoadKnowledgeHits;
  const loadStore = deps.searchStoreContent ?? searchStoreContent;
  const loadCatalog = deps.searchCatalog ?? defaultSearchCatalog;

  const config = await loadConfig(db, accountId, { requireActive: false }).catch(
    () => null
  );

  const [kbHits, storeHits, catalogHits] = await Promise.all([
    loadHits(
      db,
      accountId,
      text,
      limit,
      config?.embeddingsApiKey ?? null
    ).catch(() => [] as KnowledgeDocumentHit[]),
    loadStore(db, accountId, text, limit).catch(() => [] as ShopifyStoreContentHit[]),
    loadCatalog(db, {
      accountId,
      text,
      limit: Math.min(CATALOG_LIMIT, limit),
    }).catch(() => [] as KnowledgeCatalogHit[]),
  ]);

  const inferred = query.category ?? classifyCategory(text);
  const mapped: KnowledgeResult[] = [
    ...kbHits.map((hit) => resultFromDocument(hit)),
    ...storeHits.map((hit) => resultFromStore(hit)),
    ...catalogHits
      .filter((hit) => hit.accountId === accountId)
      .map((hit) => resultFromCatalog(hit)),
  ].filter((row) => row.source !== 'generic_model' && row.excerpt);

  const filtered =
    query.category || inferred !== 'OTHER'
      ? mapped.filter((row) => row.category === (query.category ?? inferred))
      : mapped;

  return buildBusinessKnowledgeSnapshot({
    accountId,
    query: text,
    contactId: query.contactId,
    results: filtered.slice(0, limit),
  });
}
