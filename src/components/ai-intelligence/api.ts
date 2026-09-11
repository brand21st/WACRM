import type { AiBehaviorConfig } from '@/lib/ai/intelligence/ai-behavior-types';
import type { SalesPatternAdminRow } from '@/lib/ai/intelligence/ai-intelligence-admin';

export type ApiError = { status: number; message: string };

export class IntelligenceApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IntelligenceApiError';
    this.status = status;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function friendlyError(res: Response, data: Record<string, unknown>): never {
  if (res.status === 403) {
    throw new IntelligenceApiError(
      "You don't have permission to perform this action.",
      403
    );
  }
  if (res.status === 404) {
    throw new IntelligenceApiError('Not found', 404);
  }
  const message =
    typeof data.error === 'string' &&
    data.error &&
    !/sql|supabase|postgres|relation/i.test(data.error)
      ? data.error
      : 'Something went wrong. Please try again.';
  throw new IntelligenceApiError(message, res.status);
}

async function request(
  url: string,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = await readJson(res);
  if (!res.ok) friendlyError(res, data);
  return data;
}

export type IntelligenceOverview = {
  knowledge: {
    available: boolean;
    document_count: number;
    last_updated_at: string | null;
  };
  patterns: {
    available: boolean;
    by_status: Record<string, number>;
    retrieval_eligible_count: number;
    with_effectiveness_count: number;
    underperforming_count: number;
    last_observed_at: string | null;
  };
  experiments: { available: boolean; by_status: Record<string, number> };
  flags: {
    sales_pattern_retrieval: 'off' | 'shadow' | 'on';
    ai_behavior_optimization: 'off' | 'on';
  };
};

export type ExperimentRow = {
  id: string;
  name: string;
  objective: string;
  control_version_id: string;
  variant_version_id: string;
  control_was_implicit: boolean;
  variant_allocation: number;
  status: string;
  started_at: string | null;
  ended_at: string | null;
  evaluation: {
    control?: ArmMetrics;
    variant?: ArmMetrics;
    observedImprovement?: number | null;
    candidateWinnerVersionId?: string | null;
    reason?: string;
  } | null;
  candidate_winner_version_id: string | null;
  created_at: string;
  updated_at: string;
};

export type ArmMetrics = {
  assignedCount: number;
  eligibleOutcomeCount: number;
  successCount: number;
  failureCount: number;
  unresolvedCount: number;
  observedSuccessRate: number | null;
  failureRate: number | null;
};

export type ExperimentDetail = {
  experiment: ExperimentRow;
  control_behavior: AiBehaviorConfig | null;
  variant_behavior: AiBehaviorConfig | null;
};

export type ExperimentConfig = {
  ai_behavior_optimization: 'off' | 'on';
  active_behavior: { version: number; behavior: AiBehaviorConfig } | null;
  live_experiment: {
    id: string;
    name: string;
    status: string;
    variant_allocation: number;
  } | null;
};

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

export type ObservationShadowReport = {
  available: boolean;
  window_days: number;
  since: string;
  eligible_turns: number;
  matched_turns: number;
  patterns_retrieved: number;
  average_match_score: number | null;
  top_pattern_types: Array<{ pattern_type: string; count: number }>;
  frequently_matched: Array<{
    pattern_id: string;
    pattern_type: string;
    match_count: number;
    average_match_score: number;
  }>;
  never_matched: Array<{ pattern_id: string; pattern_type: string }>;
  potentially_irrelevant: number;
  match_reasons: Array<{ reason: string; count: number }>;
  recommendations: {
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
};

export type BoundedAnalyzeResult = {
  considered: number;
  queued: number;
  skipped: number;
  queue_unavailable: boolean;
  window_days: number;
  max_conversations: number;
};

export type BoundedAnalyzePreview = {
  available: boolean;
  window_days: number;
  max_conversations: number;
  eligible_conversations: number;
  selected_conversations: number;
  eligible_turns: number;
  minimum_analyzer_pages: number;
  first_eligible_at: string | null;
  last_eligible_at: string | null;
  commerce_order_count: number;
  completed_order_count: number;
  canceled_order_count: number;
  background_learning_mode: 'off' | 'deterministic' | 'hybrid' | 'unknown';
  estimated_llm_calls: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  analyze_queue_configured: boolean;
};

export type LearningConfig = {
  background_learning_mode: 'off' | 'deterministic' | 'hybrid';
  background_learning_paused: boolean;
  background_learning_daily_conversation_limit: number;
  background_learning_daily_token_limit: number;
  recommendation_intelligence: 'off' | 'shadow';
  available?: boolean;
};

export type LearningInsightStrength = 'observed' | 'emerging' | 'strong';

export type LearningInsight = {
  id: string;
  strength: LearningInsightStrength;
  sourceLayer: 'sales_event' | 'sales_pattern' | 'recommendation';
  title: string;
  summary: string;
  evidence: {
    windowDays: number;
    sampleSize: number;
    signalCount: number;
    outcomeCount: number;
    successCount: number;
    failureCount: number;
    unresolvedCount: number;
  };
};

export type MerchantLearningSummary = {
  available: boolean;
  status:
    | 'not_installed'
    | 'off'
    | 'paused'
    | 'active_deterministic'
    | 'active_hybrid';
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

export type QueueOperationsHealth = {
  available: boolean;
  checked_at: string;
  error?: string;
  worker_heartbeats: Array<{
    group: string;
    queue_names: string[];
    age_seconds: number;
    healthy: boolean;
  }>;
  queues: Array<{
    name: string;
    group: string;
    counts: Record<string, number>;
    oldest_age_seconds: Record<string, number | null>;
  }>;
};

export async function fetchQueueOperations(): Promise<QueueOperationsHealth> {
  return (await request(
    '/api/ai/intelligence/operations'
  )) as unknown as QueueOperationsHealth;
}

export async function fetchLearningConfig(): Promise<LearningConfig> {
  return (await request(
    '/api/ai/intelligence/learning-config'
  )) as unknown as LearningConfig;
}

export async function fetchLearningSummary(): Promise<MerchantLearningSummary> {
  return (await request(
    '/api/ai/intelligence/learning-summary'
  )) as unknown as MerchantLearningSummary;
}

export async function patchLearningConfig(
  update: Partial<LearningConfig> & { confirmation?: string }
): Promise<LearningConfig> {
  return (await request('/api/ai/intelligence/learning-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  })) as unknown as LearningConfig;
}

export type DiscoverResult = {
  wrote: number;
  stale_updated: number;
  skipped: boolean;
  reason: string | null;
};

export async function fetchOverview(): Promise<IntelligenceOverview> {
  return (await request(
    '/api/ai/intelligence/overview'
  )) as IntelligenceOverview;
}

export async function fetchObservationEvents(): Promise<ObservationEventsReport> {
  return (await request(
    '/api/ai/intelligence/events'
  )) as ObservationEventsReport;
}

export async function fetchObservationVolume(): Promise<ObservationVolumeReport> {
  return (await request(
    '/api/ai/intelligence/volume'
  )) as ObservationVolumeReport;
}

export async function fetchObservationShadow(): Promise<ObservationShadowReport> {
  return (await request(
    '/api/ai/intelligence/shadow'
  )) as ObservationShadowReport;
}

export async function previewRecentAnalyze(options?: {
  windowDays?: number;
  maxConversations?: number;
}): Promise<BoundedAnalyzePreview> {
  const params = new URLSearchParams();
  if (options?.windowDays != null) {
    params.set('windowDays', String(options.windowDays));
  }
  if (options?.maxConversations != null) {
    params.set('maxConversations', String(options.maxConversations));
  }
  const query = params.toString();
  return (await request(
    `/api/ai/intelligence/analyze-recent${query ? `?${query}` : ''}`
  )) as unknown as BoundedAnalyzePreview;
}

export async function enqueueRecentAnalyze(input: {
  confirmation: string;
  windowDays?: number;
  maxConversations?: number;
}): Promise<BoundedAnalyzeResult> {
  return (await request('/api/ai/intelligence/analyze-recent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })) as BoundedAnalyzeResult;
}

export async function discoverAccountPatternsNow(): Promise<DiscoverResult> {
  return (await request('/api/ai/intelligence/discover', {
    method: 'POST',
  })) as DiscoverResult;
}

export async function fetchPatterns(): Promise<{
  available: boolean;
  patterns: SalesPatternAdminRow[];
}> {
  const data = await request('/api/ai/patterns');
  return {
    available: data.available !== false,
    patterns: (data.patterns as SalesPatternAdminRow[]) ?? [],
  };
}

export async function fetchPattern(
  id: string
): Promise<{ available: boolean; pattern: SalesPatternAdminRow | null }> {
  const data = await request(`/api/ai/patterns/${id}`);
  return {
    available: data.available !== false,
    pattern: (data.pattern as SalesPatternAdminRow) ?? null,
  };
}

export async function fetchPatternConfig(): Promise<'off' | 'shadow' | 'on'> {
  const data = await request('/api/ai/patterns/config');
  const mode = data.sales_pattern_retrieval;
  return mode === 'shadow' || mode === 'on' ? mode : 'off';
}

export async function patchPatternConfig(
  mode: 'off' | 'shadow' | 'on'
): Promise<'off' | 'shadow' | 'on'> {
  const data = await request('/api/ai/patterns/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sales_pattern_retrieval: mode }),
  });
  const next = data.sales_pattern_retrieval;
  return next === 'shadow' || next === 'on' ? next : 'off';
}

export async function fetchExperiments(): Promise<ExperimentRow[]> {
  const data = await request('/api/ai/behavior-experiments');
  return (data.experiments as ExperimentRow[]) ?? [];
}

export async function fetchExperiment(id: string): Promise<ExperimentDetail> {
  const data = await request(`/api/ai/behavior-experiments/${id}`);
  return data as unknown as ExperimentDetail;
}

export async function fetchExperimentConfig(): Promise<ExperimentConfig> {
  const data = await request('/api/ai/behavior-experiments/config');
  return {
    ai_behavior_optimization:
      data.ai_behavior_optimization === 'on' ? 'on' : 'off',
    active_behavior:
      (data.active_behavior as ExperimentConfig['active_behavior']) ?? null,
    live_experiment:
      (data.live_experiment as ExperimentConfig['live_experiment']) ?? null,
  };
}

export async function patchOptimization(
  enabled: boolean
): Promise<'off' | 'on'> {
  const data = await request('/api/ai/behavior-experiments/config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  return data.ai_behavior_optimization === 'on' ? 'on' : 'off';
}

export async function createExperiment(body: {
  name: string;
  objective: string;
  variant_allocation: number;
  behavior: AiBehaviorConfig;
}): Promise<{ experimentId: string }> {
  const data = await request('/api/ai/behavior-experiments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { experimentId: String(data.experimentId) };
}

export async function startExperiment(id: string): Promise<void> {
  await request(`/api/ai/behavior-experiments/${id}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'START CONTROLLED EXPERIMENT' }),
  });
}

export async function approveExperiment(id: string): Promise<void> {
  await request(`/api/ai/behavior-experiments/${id}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'APPROVE BEHAVIOR VERSION' }),
  });
}

export async function rollbackExperiment(id: string): Promise<void> {
  await request(`/api/ai/behavior-experiments/${id}/rollback`, {
    method: 'POST',
  });
}
