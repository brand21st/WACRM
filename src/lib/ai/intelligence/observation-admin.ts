/**
 * Read-only observation reports for AI Intelligence.
 * Session accountId is required before any grouping.
 * No transcripts, phones, emails, names, or addresses.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { isRedisConfigured } from '@/lib/queue/redis';
import { requireAccountId } from './contracts';
import { isIntelligenceRelationMissing } from './ai-intelligence-admin';
import { MIN_MATCH_SCORE } from './sales-pattern-score';

export const OBSERVATION_WINDOW_DAYS = 7;
export const SHADOW_RETENTION_DAYS = 30;
export const LOW_SHADOW_MATCH_SCORE = 40;

export function shadowRetentionSince(
  now: Date = new Date(),
  days: number = SHADOW_RETENTION_DAYS
): string {
  const boundedDays = Math.max(1, Math.min(SHADOW_RETENTION_DAYS, days));
  return new Date(
    now.getTime() - boundedDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

export type ObservationEventCount = {
  event_type: string;
  kind: string;
  count: number;
};

export type ObservationEventsReport = {
  available: boolean;
  total: number;
  by_type: ObservationEventCount[];
  first_created_at: string | null;
  last_created_at: string | null;
  truncated?: boolean;
};

export type ObservationVolumeReport = {
  available: boolean;
  conversation_count: number;
  message_count: number;
  customer_message_count: number;
  first_message_at: string | null;
  last_message_at: string | null;
  analyzed_conversation_count: number;
  analyzed_today_count: number;
  unprocessed_conversation_count: number;
  last_analyzed_at: string | null;
  recent_active_conversation_count: number;
  estimated_analyze_jobs: number;
  estimated_llm_calls_max: number;
  analyze_queue_configured: boolean;
  window_days: number;
};

export type ShadowPatternStat = {
  pattern_id: string;
  pattern_type: string;
  match_count: number;
  average_match_score: number;
};

export type ObservationShadowReport = {
  available: boolean;
  window_days: number;
  since: string;
  eligible_turns: number;
  matched_turns: number;
  patterns_retrieved: number;
  average_match_score: number | null;
  top_pattern_types: Array<{ pattern_type: string; count: number }>;
  frequently_matched: ShadowPatternStat[];
  never_matched: Array<{ pattern_id: string; pattern_type: string }>;
  potentially_irrelevant: number;
  match_reasons: Array<{ reason: string; count: number }>;
  recommendations: RecommendationShadowReport;
};

export type RecommendationShadowReport = {
  available: boolean;
  eligible_turns: number;
  baseline_result_count: number;
  shadow_result_count: number;
  average_baseline_score: number | null;
  average_shadow_score: number | null;
  rank_agreement: number | null;
  evidence_coverage: {
    baseline: number | null;
    shadow: number | null;
    delta: number | null;
  };
  reasons: Array<{ reason: string; count: number }>;
  potentially_irrelevant: number;
};

export type RecommendationShadowRow = {
  source_turn_id: string;
  baseline_product_ids: unknown;
  shadow_product_ids: unknown;
  baseline_scores: unknown;
  shadow_scores: unknown;
  baseline_evidence_count: number | null;
  shadow_evidence_count: number | null;
  shadow_reasons: unknown;
  injected: boolean;
};

type RecommendationShadowLedgerRow = {
  recommendation_set_id: string;
  source_turn_id: string | null;
  product_id: string | null;
  score: number | null;
  reasons: unknown;
  ranking_variant: 'baseline' | 'shadow';
  rank: number | null;
  baseline_rank: number | null;
  shadow_rank: number | null;
  is_injected: boolean;
};

const PII_RESPONSE_KEY =
  /phone|email|address|transcript|content_text|wa_id|display_name|customer_name/i;

export function assertSafeObservationPayload(value: unknown): void {
  const json = JSON.stringify(value);
  if (PII_RESPONSE_KEY.test(json)) {
    throw new Error(
      'observation payload must not include customer identifiers'
    );
  }
}

function isMissingSalesEventCountRpc(error: {
  message?: string;
} | null): boolean {
  return Boolean(
    error?.message &&
      /count_sales_events_by_type|function .* does not exist/i.test(
        error.message
      )
  );
}

function timestampBound(
  values: Array<string | null | undefined>,
  edge: 'first' | 'last'
): string | null {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort();
  return (edge === 'first' ? sorted[0] : sorted.at(-1)) ?? null;
}

async function loadObservationEventsFallback(
  db: SupabaseClient,
  accountId: string,
  since: string | null,
  empty: ObservationEventsReport
): Promise<ObservationEventsReport> {
  let query = db
    .from('sales_events')
    .select('event_type, kind, created_at')
    .eq('account_id', accountId);
  if (since) query = query.gte('created_at', since);
  const { data, error } = await query
    .order('created_at', { ascending: true })
    .limit(5000);
  if (error) {
    if (isIntelligenceRelationMissing(error, 'sales_events')) return empty;
    throw error;
  }
  const rows = (data ?? []) as Array<{
    event_type: string;
    kind: string;
    created_at: string;
  }>;
  const counts = new Map<string, ObservationEventCount>();
  for (const row of rows) {
    const key = `${row.event_type}:${row.kind}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else {
      counts.set(key, {
        event_type: row.event_type,
        kind: row.kind,
        count: 1,
      });
    }
  }
  const report: ObservationEventsReport = {
    available: true,
    total: rows.length,
    by_type: [...counts.values()].sort((a, b) => b.count - a.count),
    first_created_at: rows[0]?.created_at ?? null,
    last_created_at: rows[rows.length - 1]?.created_at ?? null,
    truncated: rows.length >= 5000,
  };
  assertSafeObservationPayload(report);
  return report;
}

export async function loadObservationEvents(
  db: SupabaseClient,
  accountId: string,
  options: { since?: string | null } = {}
): Promise<ObservationEventsReport> {
  const id = requireAccountId(accountId, 'loadObservationEvents');
  const empty: ObservationEventsReport = {
    available: false,
    total: 0,
    by_type: [],
    first_created_at: null,
    last_created_at: null,
  };
  const since = options.since ?? null;
  const { data, error } = await db.rpc('count_sales_events_by_type', {
    p_account_id: id,
    p_since: since,
  });
  if (error) {
    if (
      isIntelligenceRelationMissing(error, 'sales_events') ||
      isMissingSalesEventCountRpc(error)
    ) {
      return loadObservationEventsFallback(db, id, since, empty);
    }
    throw error;
  }
  const rows = (data ?? []) as Array<{
    event_type: string;
    kind: string;
    event_count: number | string;
    first_created_at: string | null;
    last_created_at: string | null;
  }>;
  const byType = rows
    .map((row) => ({
      event_type: row.event_type,
      kind: row.kind,
      count: Number(row.event_count ?? 0),
    }))
    .sort((a, b) => b.count - a.count || a.event_type.localeCompare(b.event_type));
  const report: ObservationEventsReport = {
    available: true,
    total: byType.reduce((sum, row) => sum + row.count, 0),
    by_type: byType,
    first_created_at: timestampBound(
      rows.map((row) => row.first_created_at),
      'first'
    ),
    last_created_at: timestampBound(
      rows.map((row) => row.last_created_at),
      'last'
    ),
  };
  assertSafeObservationPayload(report);
  return report;
}

export async function loadObservationVolume(
  db: SupabaseClient,
  accountId: string
): Promise<ObservationVolumeReport> {
  const id = requireAccountId(accountId, 'loadObservationVolume');
  const since = new Date(
    Date.now() - OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const [
    conversations,
    messages,
    customerMessages,
    firstMessage,
    lastMessage,
    cursors,
    recent,
  ] = await Promise.all([
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id),
    db
      .from('messages')
      .select('id, conversations!inner(account_id)', {
        count: 'exact',
        head: true,
      })
      .eq('conversations.account_id', id),
    db
      .from('messages')
      .select('id, conversations!inner(account_id)', {
        count: 'exact',
        head: true,
      })
      .eq('conversations.account_id', id)
      .eq('sender_type', 'customer'),
    db
      .from('messages')
      .select('created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', id)
      .order('created_at', { ascending: true })
      .limit(1),
    db
      .from('messages')
      .select('created_at, conversations!inner(account_id)')
      .eq('conversations.account_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
    db.rpc('count_conversation_analysis_readiness', {
      p_account_id: id,
    }),
    db
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id)
      .gte('last_customer_message_at', since),
  ]);

  if (conversations.error) throw conversations.error;
  if (messages.error) throw messages.error;
  if (customerMessages.error) throw customerMessages.error;
  if (firstMessage.error) throw firstMessage.error;
  if (lastMessage.error) throw lastMessage.error;
  if (cursors.error) {
    const missingReadiness =
      isIntelligenceRelationMissing(
        cursors.error,
        'conversation_analysis_cursors'
      ) ||
      /count_conversation_analysis_readiness|function .* does not exist/i.test(
        cursors.error.message ?? ''
      );
    if (!missingReadiness) throw cursors.error;
  }

  const readiness = Array.isArray(cursors.data)
    ? (cursors.data[0] as
        | {
            analyzed_current?: number;
            waiting?: number;
            analyzed_today?: number;
            last_analyzed_at?: string | null;
          }
        | undefined)
    : (cursors.data as
        | {
            analyzed_current?: number;
            waiting?: number;
            analyzed_today?: number;
            last_analyzed_at?: string | null;
          }
        | null);
  const conversationCount = conversations.count ?? 0;
  const analyzed = Number(readiness?.analyzed_current ?? 0);
  const waiting = Number(readiness?.waiting ?? 0);
  const analyzedToday = Number(readiness?.analyzed_today ?? 0);
  const recentActive = recent.error ? conversationCount : (recent.count ?? 0);
  const unprocessed = readiness ? waiting : Math.max(0, conversationCount - analyzed);
  const estimatedJobs = recent.error ? unprocessed : Math.min(recentActive, unprocessed || recentActive);
  const firstRow = (firstMessage.data ?? [])[0] as
    { created_at?: string } | undefined;
  const lastRow = (lastMessage.data ?? [])[0] as
    { created_at?: string } | undefined;

  const report: ObservationVolumeReport = {
    available: true,
    conversation_count: conversationCount,
    message_count: messages.count ?? 0,
    customer_message_count: customerMessages.count ?? 0,
    first_message_at: firstRow?.created_at ?? null,
    last_message_at: lastRow?.created_at ?? null,
    analyzed_conversation_count: analyzed,
    analyzed_today_count: analyzedToday,
    unprocessed_conversation_count: unprocessed,
    last_analyzed_at:
      typeof readiness?.last_analyzed_at === 'string'
        ? readiness.last_analyzed_at
        : null,
    recent_active_conversation_count: recentActive,
    estimated_analyze_jobs: estimatedJobs,
    estimated_llm_calls_max: estimatedJobs,
    analyze_queue_configured: isRedisConfigured(),
    window_days: OBSERVATION_WINDOW_DAYS,
  };
  assertSafeObservationPayload(report);
  return report;
}

export async function loadObservationShadow(
  db: SupabaseClient,
  accountId: string
): Promise<ObservationShadowReport> {
  const id = requireAccountId(accountId, 'loadObservationShadow');
  const since = shadowRetentionSince();
  const emptyRecommendations = emptyRecommendationShadowReport();
  const empty: ObservationShadowReport = {
    available: false,
    window_days: SHADOW_RETENTION_DAYS,
    since,
    eligible_turns: 0,
    matched_turns: 0,
    patterns_retrieved: 0,
    average_match_score: null,
    top_pattern_types: [],
    frequently_matched: [],
    never_matched: [],
    potentially_irrelevant: 0,
    match_reasons: [],
    recommendations: emptyRecommendations,
  };

  let { data, error } = await db
    .from('sales_pattern_shadow_diagnostics')
    .select(
      'source_turn_id, pattern_id, pattern_type, match_score, match_reasons, injected'
    )
    .eq('account_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error?.code === '42703' && /source_turn_id/i.test(error.message ?? '')) {
    const legacy = await db
      .from('sales_pattern_shadow_diagnostics')
      .select(
        'turn_id, pattern_id, pattern_type, match_score, match_reasons, injected'
      )
      .eq('account_id', id)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(2000);
    data = (legacy.data ?? []).map((row) => ({
      ...row,
      source_turn_id: row.turn_id,
    })) as typeof data;
    error = legacy.error;
  }
  if (error) {
    if (
      isIntelligenceRelationMissing(error, 'sales_pattern_shadow_diagnostics')
    ) {
      return empty;
    }
    throw error;
  }

  const rows = (data ?? []) as Array<{
    source_turn_id: string;
    pattern_id: string | null;
    pattern_type: string | null;
    match_score: number | null;
    match_reasons: unknown;
    injected: boolean;
  }>;

  const turns = new Set<string>();
  const matchedTurns = new Set<string>();
  const seenDiagnostics = new Set<string>();
  const typeCounts = new Map<string, number>();
  const patternStats = new Map<
    string,
    { pattern_type: string; match_count: number; score_sum: number }
  >();
  const reasonCounts = new Map<string, number>();
  let scoreSum = 0;
  let scoreN = 0;
  let retrieved = 0;
  let irrelevant = 0;

  for (const row of rows) {
    if (row.injected !== false || !row.source_turn_id) continue;
    const diagnosticKey = `${row.source_turn_id}:${row.pattern_id ?? 'none'}`;
    if (seenDiagnostics.has(diagnosticKey)) continue;
    seenDiagnostics.add(diagnosticKey);
    turns.add(row.source_turn_id);
    if (!row.pattern_id) continue;
    matchedTurns.add(row.source_turn_id);
    retrieved += 1;
    const type = row.pattern_type ?? 'UNKNOWN';
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    const current = patternStats.get(row.pattern_id);
    const score = typeof row.match_score === 'number' ? row.match_score : 0;
    if (typeof row.match_score === 'number') {
      scoreSum += row.match_score;
      scoreN += 1;
      if (
        row.match_score < LOW_SHADOW_MATCH_SCORE &&
        row.match_score >= MIN_MATCH_SCORE
      ) {
        irrelevant += 1;
      }
    }
    if (current) {
      current.match_count += 1;
      current.score_sum += score;
    } else {
      patternStats.set(row.pattern_id, {
        pattern_type: type,
        match_count: 1,
        score_sum: score,
      });
    }
    const reasons = Array.isArray(row.match_reasons) ? row.match_reasons : [];
    for (const reason of reasons) {
      if (typeof reason !== 'string' || !reason) continue;
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const { data: patterns, error: patternErr } = await db
    .from('sales_patterns')
    .select('id, pattern_type')
    .eq('account_id', id)
    .eq('status', 'active');
  if (
    patternErr &&
    !isIntelligenceRelationMissing(patternErr, 'sales_patterns')
  ) {
    throw patternErr;
  }
  const neverMatched = (
    (patterns ?? []) as Array<{ id: string; pattern_type: string }>
  )
    .filter((row) => !patternStats.has(row.id))
    .map((row) => ({ pattern_id: row.id, pattern_type: row.pattern_type }));

  const recommendations = await loadRecommendationShadow(db, id, since);
  const report: ObservationShadowReport = {
    available: true,
    window_days: SHADOW_RETENTION_DAYS,
    since,
    eligible_turns: turns.size,
    matched_turns: matchedTurns.size,
    patterns_retrieved: retrieved,
    average_match_score: scoreN
      ? Math.round((scoreSum / scoreN) * 10) / 10
      : null,
    top_pattern_types: [...typeCounts.entries()]
      .map(([pattern_type, count]) => ({ pattern_type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    frequently_matched: [...patternStats.entries()]
      .map(([pattern_id, stat]) => ({
        pattern_id,
        pattern_type: stat.pattern_type,
        match_count: stat.match_count,
        average_match_score:
          Math.round((stat.score_sum / stat.match_count) * 10) / 10,
      }))
      .sort((a, b) => b.match_count - a.match_count)
      .slice(0, 8),
    never_matched: neverMatched.slice(0, 20),
    potentially_irrelevant: irrelevant,
    match_reasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    recommendations,
  };
  assertSafeObservationPayload(report);
  return report;
}

export async function loadRecommendationShadow(
  db: SupabaseClient,
  accountId: string,
  since: string = shadowRetentionSince()
): Promise<RecommendationShadowReport> {
  const id = requireAccountId(accountId, 'loadRecommendationShadow');
  const { data, error } = await db
    .from('catalog_recommendation_events')
    .select(
      'recommendation_set_id, source_turn_id, product_id, score, reasons, ranking_variant, rank, baseline_rank, shadow_rank, is_injected'
    )
    .eq('account_id', id)
    .eq('event', 'generated')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) {
    if (
      isIntelligenceRelationMissing(error, 'catalog_recommendation_events') ||
      (error.code === '42703' &&
        /recommendation_set_id|source_turn_id|ranking_variant|baseline_rank|shadow_rank|is_injected/i.test(
          error.message ?? ''
        ))
    ) {
      return emptyRecommendationShadowReport();
    }
    throw error;
  }
  return summarizeRecommendationShadow(
    recommendationShadowRowsFromLedger(
      (data ?? []) as RecommendationShadowLedgerRow[]
    )
  );
}

export function recommendationShadowRowsFromLedger(
  rows: readonly RecommendationShadowLedgerRow[]
): RecommendationShadowRow[] {
  const sets = new Map<
    string,
    {
      sourceTurnId: string;
      baseline: RecommendationShadowLedgerRow[];
      shadow: RecommendationShadowLedgerRow[];
    }
  >();
  for (const row of rows) {
    if (!row.recommendation_set_id || !row.product_id) continue;
    const key = row.recommendation_set_id;
    const current = sets.get(key) ?? {
      sourceTurnId: row.source_turn_id || key,
      baseline: [],
      shadow: [],
    };
    current[row.ranking_variant === 'shadow' ? 'shadow' : 'baseline'].push(row);
    sets.set(key, current);
  }
  return [...sets.values()]
    .filter((set) => set.shadow.length > 0)
    .map((set) => {
      const byRank = (
        a: RecommendationShadowLedgerRow,
        b: RecommendationShadowLedgerRow
      ) =>
        (a.rank ??
          a.shadow_rank ??
          a.baseline_rank ??
          Number.MAX_SAFE_INTEGER) -
        (b.rank ?? b.shadow_rank ?? b.baseline_rank ?? Number.MAX_SAFE_INTEGER);
      const baseline = [...set.baseline].sort(byRank);
      const shadow = [...set.shadow].sort(byRank);
      return {
        source_turn_id: set.sourceTurnId,
        baseline_product_ids: baseline.map((row) => row.product_id),
        shadow_product_ids: shadow.map((row) => row.product_id),
        baseline_scores: baseline
          .map((row) => row.score)
          .filter((score) => score != null),
        shadow_scores: shadow
          .map((row) => row.score)
          .filter((score) => score != null),
        baseline_evidence_count: baseline.length,
        shadow_evidence_count: shadow.filter(
          (row) => Array.isArray(row.reasons) && row.reasons.length > 0
        ).length,
        shadow_reasons: shadow.flatMap((row) =>
          Array.isArray(row.reasons)
            ? row.reasons.filter(
                (reason): reason is string => typeof reason === 'string'
              )
            : []
        ),
        injected: shadow.some((row) => row.is_injected),
      };
    });
}

export function summarizeRecommendationShadow(
  rows: readonly RecommendationShadowRow[]
): RecommendationShadowReport {
  const turns = new Set<string>();
  const reasons = new Map<string, number>();
  let baselineResults = 0;
  let shadowResults = 0;
  let baselineScoreSum = 0;
  let baselineScoreCount = 0;
  let shadowScoreSum = 0;
  let shadowScoreCount = 0;
  let agreementSum = 0;
  let agreementCount = 0;
  let baselineEvidence = 0;
  let shadowEvidence = 0;
  let evidenceRows = 0;
  let irrelevant = 0;

  for (const row of rows) {
    if (row.injected !== false || !row.source_turn_id) continue;
    if (turns.has(row.source_turn_id)) continue;
    turns.add(row.source_turn_id);
    const baselineIds = stringArray(row.baseline_product_ids);
    const shadowIds = stringArray(row.shadow_product_ids);
    const baselineScores = numberArray(row.baseline_scores);
    const shadowScores = numberArray(row.shadow_scores);
    baselineResults += baselineIds.length;
    shadowResults += shadowIds.length;
    for (const score of baselineScores) baselineScoreSum += score;
    for (const score of shadowScores) shadowScoreSum += score;
    baselineScoreCount += baselineScores.length;
    shadowScoreCount += shadowScores.length;
    if (baselineIds.length || shadowIds.length) {
      agreementSum += rankAgreement(baselineIds, shadowIds);
      agreementCount += 1;
    }
    if (
      typeof row.baseline_evidence_count === 'number' &&
      typeof row.shadow_evidence_count === 'number'
    ) {
      baselineEvidence += Math.max(0, row.baseline_evidence_count);
      shadowEvidence += Math.max(0, row.shadow_evidence_count);
      evidenceRows += 1;
      if (
        row.shadow_evidence_count === 0 &&
        row.baseline_evidence_count > 0 &&
        shadowIds.length > 0
      ) {
        irrelevant += 1;
      }
    }
    for (const reason of stringArray(row.shadow_reasons)) {
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const baselineCoverage = evidenceRows
    ? round(baselineEvidence / evidenceRows)
    : null;
  const shadowCoverage = evidenceRows
    ? round(shadowEvidence / evidenceRows)
    : null;
  const report: RecommendationShadowReport = {
    available: true,
    eligible_turns: turns.size,
    baseline_result_count: baselineResults,
    shadow_result_count: shadowResults,
    average_baseline_score: baselineScoreCount
      ? round(baselineScoreSum / baselineScoreCount)
      : null,
    average_shadow_score: shadowScoreCount
      ? round(shadowScoreSum / shadowScoreCount)
      : null,
    rank_agreement: agreementCount
      ? round(agreementSum / agreementCount)
      : null,
    evidence_coverage: {
      baseline: baselineCoverage,
      shadow: shadowCoverage,
      delta:
        baselineCoverage == null || shadowCoverage == null
          ? null
          : round(shadowCoverage - baselineCoverage),
    },
    reasons: [...reasons.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
      .slice(0, 12),
    potentially_irrelevant: irrelevant,
  };
  assertSafeObservationPayload(report);
  return report;
}

export function rankAgreement(
  baselineIds: readonly string[],
  shadowIds: readonly string[]
): number {
  const denominator = Math.max(baselineIds.length, shadowIds.length);
  if (denominator === 0) return 1;
  const shadowRank = new Map(shadowIds.map((id, index) => [id, index]));
  let credit = 0;
  for (let index = 0; index < baselineIds.length; index += 1) {
    const other = shadowRank.get(baselineIds[index]);
    if (other == null) continue;
    credit += 1 / (1 + Math.abs(index - other));
  }
  return credit / denominator;
}

function emptyRecommendationShadowReport(): RecommendationShadowReport {
  return {
    available: false,
    eligible_turns: 0,
    baseline_result_count: 0,
    shadow_result_count: 0,
    average_baseline_score: null,
    average_shadow_score: null,
    rank_agreement: null,
    evidence_coverage: { baseline: null, shadow: null, delta: null },
    reasons: [],
    potentially_irrelevant: 0,
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0
  );
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is number => typeof item === 'number' && Number.isFinite(item)
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
