import type { SupabaseClient } from '@supabase/supabase-js';
import {
  attributeRecommendationOutcomes,
  type AttributedRecommendationAction,
  type CatalogOutcomeRow,
  type RecommendationEvidenceRow,
} from './recommendation-evidence';
import { materializeRecommendationShadows } from './recommendation-shadow';

export const RECOMMENDATION_INTELLIGENCE_VERSION =
  'recommendation-intelligence-v1';
const MAX_SOURCE_ROWS = 20_000;

export interface RecommendationStat {
  accountId: string;
  productId: string;
  mode: string;
  algorithmVersion: string;
  generatedCount: number;
  shownCount: number;
  selectedCount: number;
  rejectedCount: number;
  unresolvedCount: number;
  attributedOutcomeCount: number;
  selectionRate: number | null;
  rejectionRate: number | null;
  smoothedSelectionRate: number;
  smoothedRejectionRate: number;
  baselineRankAvg: number | null;
  shadowRankAvg: number | null;
  firstObservedAt: string;
  lastObservedAt: string;
}

export interface RecommendationRefreshResult {
  accountId: string;
  rebuilt: boolean;
  statsWritten: number;
  attributedOutcomes: number;
  shadowRowsWritten: number;
}

export interface RecommendationCursorClaim {
  pendingRecommendationEventCreatedAt: string | null;
  pendingRecommendationEventId: string | null;
  pendingProductEventCreatedAt: string | null;
  pendingProductEventId: string | null;
}

export function aggregateRecommendationEvidence(
  accountId: string,
  evidence: RecommendationEvidenceRow[],
  attributed: AttributedRecommendationAction[] = []
): RecommendationStat[] {
  interface MutableStat {
    accountId: string;
    productId: string;
    mode: string;
    algorithmVersion: string;
    generatedCount: number;
    shownCount: number;
    selectedCount: number;
    rejectedCount: number;
    unresolvedCount: number;
    attributedOutcomeCount: number;
    baselineRanks: number[];
    shadowRanks: number[];
    firstObservedAt: string;
    lastObservedAt: string;
  }
  const stats = new Map<string, MutableStat>();
  const get = (
    productId: string,
    mode: string,
    algorithmVersion: string,
    createdAt: string
  ) => {
    const key = `${accountId}:${productId}:${mode}:${algorithmVersion}`;
    const current = stats.get(key) ?? {
      accountId,
      productId,
      mode,
      algorithmVersion,
      generatedCount: 0,
      shownCount: 0,
      selectedCount: 0,
      rejectedCount: 0,
      unresolvedCount: 0,
      attributedOutcomeCount: 0,
      baselineRanks: [],
      shadowRanks: [],
      firstObservedAt: createdAt,
      lastObservedAt: createdAt,
    };
    if (createdAt < current.firstObservedAt)
      current.firstObservedAt = createdAt;
    if (createdAt > current.lastObservedAt) current.lastObservedAt = createdAt;
    stats.set(key, current);
    return current;
  };

  for (const row of evidence) {
    if (row.account_id !== accountId || !row.product_id) continue;
    const stat = get(
      row.product_id,
      row.mode,
      row.algorithm_version,
      row.created_at
    );
    if (row.event === 'generated') stat.generatedCount += 1;
    else if (row.event === 'shown') stat.shownCount += 1;
    else if (row.event === 'selected') stat.selectedCount += 1;
    else if (row.event === 'rejected') stat.rejectedCount += 1;
    else if (row.event === 'unresolved') stat.unresolvedCount += 1;
    if (positiveInteger(row.baseline_rank))
      stat.baselineRanks.push(row.baseline_rank!);
    if (positiveInteger(row.shadow_rank))
      stat.shadowRanks.push(row.shadow_rank!);
  }

  for (const action of attributed) {
    if (action.accountId !== accountId) continue;
    const stat = get(
      action.productId,
      action.mode,
      action.algorithmVersion,
      action.createdAt
    );
    if (action.action === 'selected') stat.selectedCount += 1;
    else stat.unresolvedCount += 1;
    stat.attributedOutcomeCount += 1;
  }

  return [...stats.values()].map((stat) => {
    const opportunities = stat.shownCount || stat.generatedCount;
    return {
      accountId: stat.accountId,
      productId: stat.productId,
      mode: stat.mode,
      algorithmVersion: stat.algorithmVersion,
      generatedCount: stat.generatedCount,
      shownCount: stat.shownCount,
      selectedCount: stat.selectedCount,
      rejectedCount: stat.rejectedCount,
      unresolvedCount: stat.unresolvedCount,
      attributedOutcomeCount: stat.attributedOutcomeCount,
      selectionRate: opportunities
        ? Math.min(1, stat.selectedCount / opportunities)
        : null,
      rejectionRate: opportunities
        ? Math.min(1, stat.rejectedCount / opportunities)
        : null,
      // Beta(1,1) prior: deliberately conservative and explicitly non-causal.
      smoothedSelectionRate: (stat.selectedCount + 1) / (opportunities + 2),
      smoothedRejectionRate: (stat.rejectedCount + 1) / (opportunities + 2),
      baselineRankAvg: average(stat.baselineRanks),
      shadowRankAvg: average(stat.shadowRanks),
      firstObservedAt: stat.firstObservedAt,
      lastObservedAt: stat.lastObservedAt,
    };
  });
}

export async function refreshRecommendationIntelligence(
  db: SupabaseClient,
  rawAccountId: string,
  options: {
    replaceStats?: (
      db: SupabaseClient,
      accountId: string,
      stats: RecommendationStat[]
    ) => Promise<number>;
  } = {}
): Promise<RecommendationRefreshResult> {
  const accountId = rawAccountId.trim();
  if (!accountId)
    throw new Error('refreshRecommendationIntelligence requires accountId');

  const [evidence, outcomes] = await Promise.all([
    loadRecommendationEvidence(db, accountId),
    loadCatalogOutcomes(db, accountId),
  ]);
  const attributed = attributeRecommendationOutcomes(evidence, outcomes);
  const stats = aggregateRecommendationEvidence(
    accountId,
    evidence,
    attributed
  );
  const statsWritten = await (
    options.replaceStats ?? replaceRecommendationStats
  )(db, accountId, stats);
  const shadowRowsWritten = await materializeRecommendationShadows(
    db,
    accountId,
    evidence
  );
  return {
    accountId,
    rebuilt: true,
    statsWritten,
    attributedOutcomes: attributed.length,
    shadowRowsWritten,
  };
}

export async function reconcileRecommendationIntelligence(
  db: SupabaseClient,
  accountId: string,
  options: {
    force?: boolean;
    loadMode?: typeof loadRecommendationIntelligenceMode;
  } = {}
): Promise<RecommendationRefreshResult | null> {
  if (
    options.force !== true &&
    (await (options.loadMode ?? loadRecommendationIntelligenceMode)(
      db,
      accountId
    )) !== 'shadow'
  ) {
    return null;
  }
  const claim = await claimRecommendationIntelligence(
    db,
    accountId,
    options.force === true
  );
  if (!claim) return null;
  try {
    const result = await refreshRecommendationIntelligence(db, accountId);
    await completeRecommendationIntelligence(db, accountId, claim);
    return result;
  } catch (error) {
    try {
      await failRecommendationIntelligence(db, accountId, error);
    } catch (markError) {
      console.error(
        '[catalog-intel] failed to persist recommendation reconciliation error',
        markError
      );
    }
    throw error;
  }
}

export async function loadRecommendationIntelligenceMode(
  db: SupabaseClient,
  accountId: string
): Promise<'off' | 'shadow'> {
  const { data, error } = await db
    .from('ai_configs')
    .select('recommendation_intelligence')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error || data?.recommendation_intelligence !== 'shadow') return 'off';
  return 'shadow';
}

export async function listDueRecommendationIntelligence(
  db: SupabaseClient,
  limit = 25
): Promise<string[]> {
  const bounded = Math.min(100, Math.max(1, Math.trunc(limit) || 25));
  const { data, error } = await db.rpc('list_due_recommendation_intelligence', {
    p_limit: bounded,
  });
  if (error) throw error;
  return (data ?? [])
    .map((row: { account_id?: unknown }) => String(row.account_id ?? '').trim())
    .filter(Boolean);
}

export async function drainRecommendationIntelligence(
  db: SupabaseClient,
  options: {
    limit?: number;
    enqueue?: (accountId: string) => Promise<boolean>;
    reconcile?: typeof reconcileRecommendationIntelligence;
  } = {}
): Promise<{ accounts: string[]; queued: number; ran: number }> {
  const accounts = await listDueRecommendationIntelligence(
    db,
    options.limit ?? 25
  );
  const reconcile = options.reconcile ?? reconcileRecommendationIntelligence;
  let queued = 0;
  let ran = 0;
  for (const accountId of accounts) {
    if (options.enqueue && (await options.enqueue(accountId))) {
      queued += 1;
      continue;
    }
    await reconcile(db, accountId);
    ran += 1;
  }
  return { accounts, queued, ran };
}

export async function loadRecommendationEvidence(
  db: SupabaseClient,
  accountId: string
): Promise<RecommendationEvidenceRow[]> {
  const { data, error } = await db
    .from('catalog_recommendation_events')
    .select(
      'id, account_id, recommendation_set_id, contact_id, conversation_id, source_message_id, source_turn_id, mode, seed_product_id, product_id, score, reasons, event, rank, algorithm_version, ranking_variant, is_shadow, is_injected, baseline_rank, shadow_rank, created_at'
    )
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
    .limit(MAX_SOURCE_ROWS + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MAX_SOURCE_ROWS)
    throw new Error('recommendation evidence exceeds bounded rebuild limit');
  return (data ?? []) as RecommendationEvidenceRow[];
}

export async function loadCatalogOutcomes(
  db: SupabaseClient,
  accountId: string
): Promise<CatalogOutcomeRow[]> {
  const { data, error } = await db
    .from('catalog_product_events')
    .select('id, account_id, conversation_id, product_id, event, created_at')
    .eq('account_id', accountId)
    .in('event', ['add_to_cart', 'purchase'])
    .order('created_at', { ascending: true })
    .limit(MAX_SOURCE_ROWS + 1);
  if (error) throw error;
  if ((data?.length ?? 0) > MAX_SOURCE_ROWS)
    throw new Error('catalog outcomes exceed bounded rebuild limit');
  return (data ?? []) as CatalogOutcomeRow[];
}

export async function claimRecommendationIntelligence(
  db: SupabaseClient,
  accountId: string,
  force = false
): Promise<RecommendationCursorClaim | null> {
  const { data, error } = await db.rpc('claim_recommendation_intelligence', {
    p_account_id: accountId,
    p_force: force,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    pendingRecommendationEventCreatedAt:
      row.pending_recommendation_event_created_at ?? null,
    pendingRecommendationEventId: row.pending_recommendation_event_id ?? null,
    pendingProductEventCreatedAt: row.pending_product_event_created_at ?? null,
    pendingProductEventId: row.pending_product_event_id ?? null,
  };
}

export async function completeRecommendationIntelligence(
  db: SupabaseClient,
  accountId: string,
  claim: RecommendationCursorClaim
): Promise<void> {
  const { error } = await db.rpc('complete_recommendation_intelligence', {
    p_account_id: accountId,
    p_recommendation_created_at: claim.pendingRecommendationEventCreatedAt,
    p_recommendation_id: claim.pendingRecommendationEventId,
    p_product_created_at: claim.pendingProductEventCreatedAt,
    p_product_id: claim.pendingProductEventId,
  });
  if (error) throw error;
}

export async function failRecommendationIntelligence(
  db: SupabaseClient,
  accountId: string,
  error: unknown
): Promise<void> {
  const message =
    error instanceof Error
      ? error.message
      : error &&
          typeof error === 'object' &&
          typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : String(error);
  const { error: writeError } = await db.rpc(
    'fail_recommendation_intelligence',
    {
      p_account_id: accountId,
      p_error: message.slice(0, 1000),
    }
  );
  if (writeError) throw writeError;
}

export async function replaceRecommendationStats(
  db: SupabaseClient,
  accountId: string,
  stats: RecommendationStat[]
): Promise<number> {
  const { data, error } = await db.rpc('replace_catalog_recommendation_stats', {
    p_account_id: accountId,
    p_rows: stats.map(toStatsRow),
  });
  if (error) throw error;
  return Number(data) || 0;
}

function toStatsRow(stat: RecommendationStat) {
  return {
    product_id: stat.productId,
    mode: stat.mode,
    algorithm_version: stat.algorithmVersion,
    generated_count: stat.generatedCount,
    shown_count: stat.shownCount,
    selected_count: stat.selectedCount,
    rejected_count: stat.rejectedCount,
    unresolved_count: stat.unresolvedCount,
    attributed_outcome_count: stat.attributedOutcomeCount,
    selection_rate: stat.selectionRate,
    rejection_rate: stat.rejectionRate,
    smoothed_selection_rate: stat.smoothedSelectionRate,
    smoothed_rejection_rate: stat.smoothedRejectionRate,
    baseline_rank_avg: stat.baselineRankAvg,
    shadow_rank_avg: stat.shadowRankAvg,
    first_observed_at: stat.firstObservedAt,
    last_observed_at: stat.lastObservedAt,
  };
}

function positiveInteger(value: number | null | undefined): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
