import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { enqueueAiRecommendationIntelligence } from '@/lib/queue/enqueue';
import { aiRecommendationIntelligenceJob } from '@/lib/queue/jobs';
import { validateCatalogIds } from './shopping-context';
import type { RecommendReason } from './types';

export const BASELINE_RECOMMENDATION_ALGORITHM = 'catalog-baseline-v1';
export const LEARNED_RECOMMENDATION_ALGORITHM = 'catalog-learned-v1';

export type RecommendationAction =
  'generated' | 'shown' | 'selected' | 'rejected' | 'unresolved';
export type RecommendationRankingVariant = 'baseline' | 'shadow';

export interface RecommendationEvidenceRow {
  id?: string;
  account_id: string;
  recommendation_set_id: string;
  contact_id?: string | null;
  conversation_id?: string | null;
  source_message_id?: string | null;
  source_turn_id?: string | null;
  mode: string;
  seed_product_id?: string | null;
  product_id: string | null;
  score?: number | null;
  reasons?: string[] | null;
  event: RecommendationAction;
  rank?: number | null;
  algorithm_version: string;
  ranking_variant: RecommendationRankingVariant;
  is_shadow: boolean;
  is_injected: boolean;
  baseline_rank?: number | null;
  shadow_rank?: number | null;
  created_at: string;
}

export interface CatalogOutcomeRow {
  id: string;
  account_id: string;
  conversation_id?: string | null;
  product_id?: string | null;
  event: string;
  created_at: string;
}

export interface AttributedRecommendationAction {
  accountId: string;
  recommendationSetId: string;
  productId: string;
  mode: string;
  algorithmVersion: string;
  action: 'selected' | 'unresolved';
  sourceOutcomeId: string;
  confidence: 'mapped' | 'unmapped' | 'ambiguous';
  createdAt: string;
}

export interface RecommendationRecordInput {
  accountId: string;
  recommendationSetId?: string;
  contactId?: string | null;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  sourceTurnId?: string | null;
  mode: string;
  seedProductId?: string | null;
  rows: Array<{
    product: { id: string };
    score: number;
    reasons: RecommendReason[];
    baselineRank?: number;
    shadowRank?: number;
  }>;
  event: RecommendationAction;
  algorithmVersion?: string;
  rankingVariant?: RecommendationRankingVariant;
  isShadow?: boolean;
  isInjected?: boolean;
}

export function stableRecommendationSetId(args: {
  accountId: string;
  conversationId?: string | null;
  sourceMessageId?: string | null;
  sourceTurnId?: string | null;
  mode: string;
  seedProductId?: string | null;
  productIds?: string[];
}): string {
  const identity = JSON.stringify({
    accountId: args.accountId.trim(),
    conversationId: args.conversationId?.trim() || null,
    sourceMessageId: args.sourceMessageId?.trim() || null,
    sourceTurnId: args.sourceTurnId?.trim() || null,
    mode: args.mode.trim(),
    seedProductId: args.seedProductId?.trim() || null,
    productIds: [...new Set(args.productIds ?? [])].sort(),
  });
  const hex = createHash('sha256')
    .update(identity)
    .digest('hex')
    .slice(0, 32)
    .split('');
  hex[12] = '5';
  hex[16] = ['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export async function recordRecommendationEvidence(
  db: SupabaseClient,
  input: RecommendationRecordInput
): Promise<string | null> {
  if (!input.rows.length) return null;
  const accountId = input.accountId.trim();
  const validIds = new Set(
    await validateCatalogIds(
      db,
      accountId,
      input.rows.map((row) => row.product.id)
    )
  );
  const rows = input.rows.filter((row) => validIds.has(row.product.id));
  if (!rows.length) return null;
  const setId =
    input.recommendationSetId ??
    stableRecommendationSetId({
      accountId,
      conversationId: input.conversationId,
      sourceMessageId: input.sourceMessageId,
      sourceTurnId: input.sourceTurnId,
      mode: input.mode,
      seedProductId: input.seedProductId,
      productIds: rows.map((row) => row.product.id),
    });
  const variant = input.rankingVariant ?? 'baseline';
  const payload = rows.map((row, index) => ({
    account_id: accountId,
    recommendation_set_id: setId,
    contact_id: input.contactId ?? null,
    conversation_id: input.conversationId ?? null,
    source_message_id: input.sourceMessageId ?? null,
    source_turn_id: input.sourceTurnId ?? null,
    mode: input.mode,
    seed_product_id: input.seedProductId ?? null,
    product_id: row.product.id,
    score: row.score,
    reasons: row.reasons,
    event: input.event,
    rank: index + 1,
    algorithm_version:
      input.algorithmVersion ??
      (variant === 'shadow'
        ? LEARNED_RECOMMENDATION_ALGORITHM
        : BASELINE_RECOMMENDATION_ALGORITHM),
    ranking_variant: variant,
    is_shadow: input.isShadow ?? variant === 'shadow',
    is_injected: input.isInjected ?? variant === 'baseline',
    baseline_rank:
      row.baselineRank ?? (variant === 'baseline' ? index + 1 : null),
    shadow_rank: row.shadowRank ?? (variant === 'shadow' ? index + 1 : null),
  }));
  const { error } = await db
    .from('catalog_recommendation_events')
    .upsert(payload, {
      onConflict:
        'account_id,recommendation_set_id,product_id,event,ranking_variant',
      ignoreDuplicates: false,
    });
  if (error) throw error;
  void enqueueAiRecommendationIntelligence(
    aiRecommendationIntelligenceJob(accountId)
  );
  return setId;
}

/**
 * Commerce outcomes are observational. A mapped product is trusted only when
 * exactly one injected set in the conversation contains it. An unmapped
 * outcome is never assigned to a product. Every unmapped or co-occurring
 * ambiguity is retained as unresolved instead of guessed.
 */
export function attributeRecommendationOutcomes(
  evidence: RecommendationEvidenceRow[],
  outcomes: CatalogOutcomeRow[]
): AttributedRecommendationAction[] {
  const sets = recommendationSets(evidence);
  const actions: AttributedRecommendationAction[] = [];
  for (const outcome of outcomes) {
    if (!isPositiveOutcome(outcome.event)) continue;
    const eligible = sets.filter(
      (set) =>
        set.accountId === outcome.account_id &&
        Boolean(set.conversationId) &&
        set.conversationId === outcome.conversation_id &&
        set.createdAt <= outcome.created_at
    );
    if (!eligible.length) continue;
    const mapped = outcome.product_id
      ? eligible.filter((set) => set.products.has(outcome.product_id!))
      : [];
    if (outcome.product_id && mapped.length === 1) {
      const set = mapped[0];
      actions.push(
        actionFor(set, outcome.product_id, outcome, 'selected', 'mapped')
      );
      continue;
    }
    const ambiguous = mapped.length > 1 ? mapped : eligible;
    for (const set of ambiguous) {
      for (const productId of set.products) {
        actions.push(
          actionFor(
            set,
            productId,
            outcome,
            'unresolved',
            outcome.product_id ? 'ambiguous' : 'unmapped'
          )
        );
      }
    }
  }
  return dedupeActions(actions);
}

interface EvidenceSet {
  accountId: string;
  recommendationSetId: string;
  conversationId: string | null;
  mode: string;
  algorithmVersion: string;
  products: Set<string>;
  createdAt: string;
}

function recommendationSets(
  evidence: RecommendationEvidenceRow[]
): EvidenceSet[] {
  const byId = new Map<string, EvidenceSet>();
  const injected = evidence.filter(
    (row) =>
      row.is_injected &&
      !row.is_shadow &&
      row.product_id &&
      (row.event === 'shown' || row.event === 'generated')
  );
  const shownSets = new Set(
    injected
      .filter((row) => row.event === 'shown')
      .map((row) => row.recommendation_set_id)
  );
  for (const row of injected) {
    if (shownSets.has(row.recommendation_set_id) && row.event !== 'shown')
      continue;
    const key = `${row.account_id}:${row.recommendation_set_id}`;
    const set = byId.get(key) ?? {
      accountId: row.account_id,
      recommendationSetId: row.recommendation_set_id,
      conversationId: row.conversation_id ?? null,
      mode: row.mode,
      algorithmVersion: row.algorithm_version,
      products: new Set<string>(),
      createdAt: row.created_at,
    };
    set.products.add(row.product_id!);
    if (row.created_at < set.createdAt) set.createdAt = row.created_at;
    byId.set(key, set);
  }
  return [...byId.values()];
}

function actionFor(
  set: EvidenceSet,
  productId: string,
  outcome: CatalogOutcomeRow,
  action: 'selected' | 'unresolved',
  confidence: AttributedRecommendationAction['confidence']
): AttributedRecommendationAction {
  return {
    accountId: set.accountId,
    recommendationSetId: set.recommendationSetId,
    productId,
    mode: set.mode,
    algorithmVersion: set.algorithmVersion,
    action,
    sourceOutcomeId: outcome.id,
    confidence,
    createdAt: outcome.created_at,
  };
}

function isPositiveOutcome(event: string): boolean {
  return event === 'add_to_cart' || event === 'purchase';
}

function dedupeActions(
  actions: AttributedRecommendationAction[]
): AttributedRecommendationAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    const key = [
      action.accountId,
      action.recommendationSetId,
      action.productId,
      action.action,
      action.action === 'selected'
        ? 'positive-outcome'
        : action.sourceOutcomeId,
    ].join(':');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
