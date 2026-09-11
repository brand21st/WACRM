import type { SupabaseClient } from '@supabase/supabase-js';

import {
  isMissingDbColumn,
  isMissingDbRelation,
} from '@/lib/shopify/config-db';
import { requireAccountId } from './contracts';
import {
  loadObservationEvents,
  loadObservationVolume,
  OBSERVATION_WINDOW_DAYS,
  type ObservationEventCount,
  type ObservationEventsReport,
  type ObservationVolumeReport,
} from './observation-admin';

export type LearningSummaryStatus =
  'not_installed' | 'off' | 'paused' | 'active_deterministic' | 'active_hybrid';

export type LearningInsightStrength = 'observed' | 'emerging' | 'strong';
export type LearningInsightSource =
  'sales_event' | 'sales_pattern' | 'recommendation';

export type LearningInsightEvidence = {
  windowDays: number;
  sampleSize: number;
  signalCount: number;
  outcomeCount: number;
  successCount: number;
  failureCount: number;
  unresolvedCount: number;
};

export type LearningInsight = {
  id: string;
  strength: LearningInsightStrength;
  sourceLayer: LearningInsightSource;
  title: string;
  summary: string;
  evidence: LearningInsightEvidence;
};

export type MerchantLearningSummary = {
  available: boolean;
  status: LearningSummaryStatus;
  window_days: number;
  metrics: {
    conversations: number;
    analyzed: number;
    analyzed_today: number;
    waiting: number;
    new_sales_events: number;
    insight_count: number;
    emerging_pattern_count: number;
    strong_pattern_count: number;
    recommendation_signal_count: number | null;
    customer_trend_count: number;
    last_analyzed_at: string | null;
  };
  insights: LearningInsight[];
  empty_state: string | null;
};

type LearningControls = {
  available: boolean;
  mode: 'off' | 'deterministic' | 'hybrid';
  paused: boolean;
};

type PatternRow = {
  id: string;
  pattern_type: string;
  status: string;
  sample_count: number;
  success_count: number;
  failure_count: number;
  eligible_outcome_count: number;
  unresolved_count: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
};

type RecommendationSummary = {
  available: boolean;
  shownCount: number;
  selectedCount: number;
  rejectedCount: number;
  unresolvedCount: number;
  lastObservedAt: string | null;
};

export type LearningSummaryInput = {
  controls: LearningControls;
  volume: ObservationVolumeReport;
  events: ObservationEventsReport;
  patterns: { available: boolean; rows: PatternRow[] };
  recommendations: RecommendationSummary;
};

const EVENT_TEMPLATES: Record<string, { title: string; subject: string }> = {
  PRICE_OBJECTION: {
    title: 'Price objections observed',
    subject: 'Price objections',
  },
  PRODUCT_OBJECTION: {
    title: 'Product objections observed',
    subject: 'Product objections',
  },
  PRODUCT_COMPARISON: {
    title: 'Product comparisons observed',
    subject: 'Product comparisons',
  },
  PURCHASE_INTENT: {
    title: 'Purchase intent observed',
    subject: 'Purchase-intent signals',
  },
  DISCOUNT_REQUEST: {
    title: 'Discount requests observed',
    subject: 'Discount requests',
  },
  SHIPPING_INQUIRY: {
    title: 'Shipping questions observed',
    subject: 'Shipping questions',
  },
  RETURN_INQUIRY: {
    title: 'Return questions observed',
    subject: 'Return questions',
  },
  AVAILABILITY_INQUIRY: {
    title: 'Availability questions observed',
    subject: 'Availability questions',
  },
  SIZE_INQUIRY: {
    title: 'Size questions observed',
    subject: 'Size questions',
  },
  COLOR_INQUIRY: {
    title: 'Color questions observed',
    subject: 'Color questions',
  },
};

const PATTERN_TITLES: Record<string, string> = {
  PRICE_OBJECTION: 'Price objection pattern',
  PRODUCT_OBJECTION: 'Product objection pattern',
  PRODUCT_COMPARISON: 'Product comparison pattern',
  PURCHASE_INTENT: 'Purchase intent pattern',
  PRODUCT_INQUIRY: 'Product inquiry pattern',
  DISCOUNT_REQUEST: 'Discount request pattern',
  SHIPPING_CONCERN: 'Shipping concern pattern',
  RETURN_CONCERN: 'Return concern pattern',
  GENERAL_SALES: 'General sales pattern',
};

const STRENGTH_ORDER: Record<LearningInsightStrength, number> = {
  strong: 3,
  emerging: 2,
  observed: 1,
};

function emptyEvidence(
  windowDays: number,
  sampleSize: number
): LearningInsightEvidence {
  return {
    windowDays,
    sampleSize,
    signalCount: 0,
    outcomeCount: 0,
    successCount: 0,
    failureCount: 0,
    unresolvedCount: 0,
  };
}

function resolveStatus(controls: LearningControls): LearningSummaryStatus {
  if (!controls.available) return 'not_installed';
  if (controls.mode === 'off') return 'off';
  if (controls.paused) return 'paused';
  return controls.mode === 'hybrid' ? 'active_hybrid' : 'active_deterministic';
}

function latestTimestamp(values: Array<string | null>): string | null {
  return (
    values
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null
  );
}

function compileEventInsights(
  events: ObservationEventCount[],
  windowDays: number
): LearningInsight[] {
  return events.flatMap((event) => {
    const template = EVENT_TEMPLATES[event.event_type];
    if (!template || event.kind !== 'signal' || event.count < 5) return [];
    return [
      {
        id: `event:${event.event_type}`,
        strength: 'observed' as const,
        sourceLayer: 'sales_event' as const,
        title: template.title,
        summary: `${template.subject} appeared ${event.count} times in the last ${windowDays} days.`,
        evidence: {
          ...emptyEvidence(windowDays, event.count),
          signalCount: event.count,
        },
      },
    ];
  });
}

function lifetimeWindowDays(
  firstObservedAt: string | null,
  lastObservedAt: string | null
): number {
  if (!firstObservedAt || !lastObservedAt) return 0;
  const start = Date.parse(firstObservedAt);
  const end = Date.parse(lastObservedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.max(1, Math.ceil((end - start) / 86_400_000));
}

function compilePatternInsights(patterns: PatternRow[]): LearningInsight[] {
  return patterns.flatMap((pattern) => {
    if (
      !PATTERN_TITLES[pattern.pattern_type] ||
      pattern.status === 'stale' ||
      pattern.status === 'archived' ||
      pattern.sample_count < 5
    ) {
      return [];
    }
    const strong =
      pattern.status === 'active' &&
      pattern.sample_count >= 20 &&
      pattern.eligible_outcome_count >= 5;
    const strength: LearningInsightStrength = strong ? 'strong' : 'emerging';
    const eligible = pattern.eligible_outcome_count;
    const outcomeCopy =
      eligible > 0
        ? ` ${eligible} trusted outcomes are eligible for evaluation; ${pattern.unresolved_count} remain unresolved.`
        : ' Trusted outcome evidence is not available yet.';
    const windowDays = lifetimeWindowDays(
      pattern.first_observed_at,
      pattern.last_observed_at
    );
    return [
      {
        id: `pattern:${pattern.id}`,
        strength,
        sourceLayer: 'sales_pattern' as const,
        title: PATTERN_TITLES[pattern.pattern_type],
        summary: `${strong ? 'Strong evidence' : 'An emerging pattern'} appeared across ${pattern.sample_count} observations.${outcomeCopy}`,
        evidence: {
          windowDays,
          sampleSize: pattern.sample_count,
          signalCount: pattern.sample_count,
          outcomeCount: eligible,
          successCount: pattern.success_count,
          failureCount: pattern.failure_count,
          unresolvedCount: pattern.unresolved_count,
        },
      },
    ];
  });
}

function compileRecommendationInsight(
  recommendation: RecommendationSummary,
  windowDays: number
): LearningInsight[] {
  if (!recommendation.available || recommendation.selectedCount < 5) return [];
  return [
    {
      id: 'recommendation:selection',
      strength: 'observed',
      sourceLayer: 'recommendation',
      title: 'Recommendation selections observed',
      summary: `${recommendation.selectedCount} recommendation selections were observed from ${recommendation.shownCount} shown recommendations. This is an association, not proof that the recommendation caused an outcome.`,
      evidence: {
        windowDays,
        sampleSize: recommendation.shownCount,
        signalCount: recommendation.shownCount,
        outcomeCount:
          recommendation.selectedCount + recommendation.rejectedCount,
        successCount: recommendation.selectedCount,
        failureCount: recommendation.rejectedCount,
        unresolvedCount: recommendation.unresolvedCount,
      },
    },
  ];
}

function emptyMetrics(
  input: LearningSummaryInput
): MerchantLearningSummary['metrics'] {
  return {
    conversations: input.volume.conversation_count,
    analyzed: input.volume.analyzed_conversation_count,
    analyzed_today: input.volume.analyzed_today_count,
    waiting: input.volume.unprocessed_conversation_count,
    new_sales_events: 0,
    insight_count: 0,
    emerging_pattern_count: 0,
    strong_pattern_count: 0,
    recommendation_signal_count: null,
    customer_trend_count: 0,
    last_analyzed_at: input.volume.last_analyzed_at,
  };
}

export function compileMerchantLearningSummary(
  input: LearningSummaryInput
): MerchantLearningSummary {
  const status = resolveStatus(input.controls);
  const waiting = input.volume.unprocessed_conversation_count;
  const active =
    status === 'active_deterministic' || status === 'active_hybrid';

  if (!active) {
    const stateCopy =
      status === 'not_installed'
        ? 'Background learning is not installed on this database yet.'
        : status === 'paused'
          ? 'Background learning is paused.'
          : 'Background learning is off.';
    return {
      available: input.controls.available,
      status,
      window_days: input.volume.window_days,
      metrics: emptyMetrics(input),
      insights: [],
      empty_state: `${stateCopy} ${waiting} conversations are waiting. Deterministic analysis will not change customer replies.`,
    };
  }

  const eventInsights = input.events.available
    ? compileEventInsights(input.events.by_type, input.volume.window_days)
    : [];
  const patternInsights = input.patterns.available
    ? compilePatternInsights(input.patterns.rows)
    : [];
  const recommendationInsights = compileRecommendationInsight(
    input.recommendations,
    input.volume.window_days
  );
  const candidateInsights = [
    ...eventInsights,
    ...patternInsights,
    ...recommendationInsights,
  ]
    .sort(
      (a, b) =>
        STRENGTH_ORDER[b.strength] - STRENGTH_ORDER[a.strength] ||
        b.evidence.sampleSize - a.evidence.sampleSize ||
        a.id.localeCompare(b.id)
    )
    .slice(0, 8);
  const evidenceAvailable =
    input.events.available ||
    input.patterns.available ||
    input.recommendations.available;
  const insights = evidenceAvailable ? candidateInsights : [];
  const emergingPatternCount = input.patterns.rows.filter(
    (row) =>
      (row.status === 'candidate' || row.status === 'active') &&
      row.sample_count >= 5 &&
      !(
        row.status === 'active' &&
        row.sample_count >= 20 &&
        row.eligible_outcome_count >= 5
      )
  ).length;
  const strongPatternCount = input.patterns.rows.filter(
    (row) =>
      row.status === 'active' &&
      row.sample_count >= 20 &&
      row.eligible_outcome_count >= 5
  ).length;

  return {
    available: evidenceAvailable,
    status,
    window_days: input.volume.window_days,
    metrics: {
      conversations: input.volume.conversation_count,
      analyzed: input.volume.analyzed_conversation_count,
      analyzed_today: input.volume.analyzed_today_count,
      waiting,
      new_sales_events: input.events.available ? input.events.total : 0,
      insight_count: insights.length,
      emerging_pattern_count: emergingPatternCount,
      strong_pattern_count: strongPatternCount,
      recommendation_signal_count: input.recommendations.available
        ? input.recommendations.selectedCount
        : null,
      customer_trend_count: eventInsights.length,
      last_analyzed_at: latestTimestamp([
        input.volume.last_analyzed_at,
        input.events.last_created_at,
        ...input.patterns.rows.map((row) => row.last_observed_at),
        input.recommendations.lastObservedAt,
      ]),
    },
    insights,
    empty_state: !evidenceAvailable
      ? 'Learning data is not available yet. Customer replies remain unchanged.'
      : insights.length === 0
        ? 'No evidence-backed insights yet. Vachat will show patterns after enough observations accumulate.'
        : null,
  };
}

function missingLearningControls(
  error: {
    code?: string;
    message?: string;
  } | null
): boolean {
  return (
    isMissingDbRelation(error, 'ai_configs') ||
    isMissingDbColumn(error, 'background_learning_mode') ||
    isMissingDbColumn(error, 'background_learning_paused')
  );
}

async function loadLearningControls(
  db: SupabaseClient,
  accountId: string
): Promise<LearningControls> {
  const { data, error } = await db
    .from('ai_configs')
    .select('background_learning_mode, background_learning_paused')
    .eq('account_id', accountId)
    .maybeSingle();
  if (missingLearningControls(error)) {
    return { available: false, mode: 'off', paused: false };
  }
  if (error) throw error;
  const mode =
    data?.background_learning_mode === 'deterministic' ||
    data?.background_learning_mode === 'hybrid'
      ? data.background_learning_mode
      : 'off';
  return {
    available: true,
    mode,
    paused: data?.background_learning_paused === true,
  };
}

async function loadRecentObservationEvents(
  db: SupabaseClient,
  accountId: string
): Promise<ObservationEventsReport> {
  const since = new Date(
    Date.now() - OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  return loadObservationEvents(db, accountId, { since });
}

async function loadPatterns(
  db: SupabaseClient,
  accountId: string
): Promise<LearningSummaryInput['patterns']> {
  const { data, error } = await db
    .from('sales_patterns')
    .select(
      'id, pattern_type, status, sample_count, success_count, failure_count, eligible_outcome_count, unresolved_count, first_observed_at, last_observed_at'
    )
    .eq('account_id', accountId)
    .order('sample_count', { ascending: false })
    .limit(80);
  if (
    isMissingDbRelation(error, 'sales_patterns') ||
    isMissingDbColumn(error, 'eligible_outcome_count') ||
    isMissingDbColumn(error, 'unresolved_count')
  ) {
    return { available: false, rows: [] };
  }
  if (error) throw error;
  return { available: true, rows: (data ?? []) as PatternRow[] };
}

async function loadRecommendationSummary(
  db: SupabaseClient,
  accountId: string
): Promise<RecommendationSummary> {
  const unavailable: RecommendationSummary = {
    available: false,
    shownCount: 0,
    selectedCount: 0,
    rejectedCount: 0,
    unresolvedCount: 0,
    lastObservedAt: null,
  };
  const since = new Date(
    Date.now() - OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
  const { data, error } = await db
    .from('catalog_recommendation_stats')
    .select(
      'shown_count, selected_count, rejected_count, unresolved_count, last_observed_at'
    )
    .eq('account_id', accountId)
    .gte('last_observed_at', since)
    .limit(500);
  if (
    isMissingDbRelation(error, 'catalog_recommendation_stats') ||
    isMissingDbColumn(error, 'shown_count') ||
    isMissingDbColumn(error, 'selected_count') ||
    isMissingDbColumn(error, 'rejected_count') ||
    isMissingDbColumn(error, 'unresolved_count')
  ) {
    return unavailable;
  }
  if (error) throw error;

  return (data ?? []).reduce<RecommendationSummary>(
    (summary, row) => ({
      available: true,
      shownCount: summary.shownCount + Number(row.shown_count ?? 0),
      selectedCount: summary.selectedCount + Number(row.selected_count ?? 0),
      rejectedCount: summary.rejectedCount + Number(row.rejected_count ?? 0),
      unresolvedCount:
        summary.unresolvedCount + Number(row.unresolved_count ?? 0),
      lastObservedAt: latestTimestamp([
        summary.lastObservedAt,
        typeof row.last_observed_at === 'string' ? row.last_observed_at : null,
      ]),
    }),
    { ...unavailable, available: true }
  );
}

export type LearningSummaryDependencies = {
  loadVolume: typeof loadObservationVolume;
  loadEvents: typeof loadRecentObservationEvents;
  loadControls: typeof loadLearningControls;
  loadPatterns: typeof loadPatterns;
  loadRecommendations: typeof loadRecommendationSummary;
};

const DEFAULT_DEPENDENCIES: LearningSummaryDependencies = {
  loadVolume: loadObservationVolume,
  loadEvents: loadRecentObservationEvents,
  loadControls: loadLearningControls,
  loadPatterns,
  loadRecommendations: loadRecommendationSummary,
};

export async function loadMerchantLearningSummary(
  db: SupabaseClient,
  accountId: string,
  dependencies: LearningSummaryDependencies = DEFAULT_DEPENDENCIES
): Promise<MerchantLearningSummary> {
  const id = requireAccountId(accountId, 'loadMerchantLearningSummary');
  const [volume, controls] = await Promise.all([
    dependencies.loadVolume(db, id),
    dependencies.loadControls(db, id),
  ]);

  if (!controls.available || controls.mode === 'off' || controls.paused) {
    return compileMerchantLearningSummary({
      controls,
      volume,
      events: {
        available: false,
        total: 0,
        by_type: [],
        first_created_at: null,
        last_created_at: null,
      },
      patterns: { available: false, rows: [] },
      recommendations: {
        available: false,
        shownCount: 0,
        selectedCount: 0,
        rejectedCount: 0,
        unresolvedCount: 0,
        lastObservedAt: null,
      },
    });
  }

  const [events, patterns, recommendations] = await Promise.all([
    dependencies.loadEvents(db, id),
    dependencies.loadPatterns(db, id),
    dependencies.loadRecommendations(db, id),
  ]);
  return compileMerchantLearningSummary({
    controls,
    volume,
    events,
    patterns,
    recommendations,
  });
}
