import type { AiBehaviorConfig } from '@/lib/ai/intelligence/ai-behavior-types';
import type { ExperimentRow } from './api';

export const UNAVAILABLE_COPY = 'Sales intelligence data is not available yet.';
export const LEARNING_UNAVAILABLE_COPY =
  'Background learning controls are not installed on this database yet. Customer replies stay unchanged.';
export const NO_DATA_COPY = 'No data yet';
export const NO_PATTERNS_COPY = 'No learned sales patterns yet.';
export const NO_PATTERNS_SUB =
  'Patterns appear after Vachat has enough conversation and outcome data.';
export const NO_EVENTS_COPY = 'No sales events observed yet.';
export const NO_EVENTS_SUB =
  'Events appear after recent conversations are analyzed in the background.';
export const NO_SHADOW_COPY = 'No shadow retrieval diagnostics yet.';
export const NO_SHADOW_SUB =
  'Diagnostics appear after retrieval is set to Shadow and customers send eligible messages.';
export const NO_EXPERIMENTS_COPY = 'No experiments yet.';
export const NO_EXPERIMENTS_SUB =
  'Create a controlled experiment once your AI has enough sales intelligence data.';
export const PERMISSION_COPY =
  "You don't have permission to perform this action.";
export const START_FLAG_OFF_COPY =
  'AI behavior optimization is disabled. Enable it in Settings before starting an experiment.';
export const ANALYZE_RECENT_CONFIRMATION = 'ANALYZE RECENT CONVERSATIONS';
export const ANALYZE_RECENT_HELP =
  'This queues a bounded batch (default 10 conversations from the last 7 days, hard cap 100). It does not analyze all recent conversations.';
export const CAUSAL_DISCLAIMER =
  'Observed improvement does not establish universal causal truth.';
export const EVALUATING_COPY =
  'New conversations are no longer being assigned to this experiment. Existing experiment conversations may continue contributing outcomes until their attribution window closes.';
export const CANDIDATE_COPY = 'Candidate improvement detected';

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  running: 'Running',
  evaluating: 'Evaluating',
  approved: 'Approved',
  rolled_back: 'Rolled Back',
  archived: 'Archived',
  candidate: 'Candidate',
  active: 'Active',
  stale: 'Stale',
};

export const RETRIEVAL_HELP = {
  off: 'Learned sales patterns are not used in customer replies.',
  shadow: 'Patterns are evaluated internally but are not shown to customers.',
  on: 'Relevant learned sales guidance may influence customer-facing AI replies.',
} as const;

const PII_KEY =
  /id|phone|email|name|transcript|conversation|customer|wa_id|jid/i;

export function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function summarizeContext(context: unknown): string {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return '—';
  }
  const parts: string[] = [];
  for (const [key, value] of Object.entries(
    context as Record<string, unknown>
  )) {
    if (PII_KEY.test(key)) continue;
    if (value == null || typeof value === 'object') continue;
    const text = String(value).trim();
    if (!text) continue;
    parts.push(`${humanizeKey(key)}: ${text}`);
    if (parts.length >= 3) break;
  }
  return parts.join(' · ') || '—';
}

export function formatPercent(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatImprovement(
  value: number | null | undefined
): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const points = (value * 100).toFixed(1);
  const signed = value > 0 ? `+${points}` : points;
  return `${signed} percentage points`;
}

export function observedEffectiveness(effectiveness: unknown): string | null {
  if (
    !effectiveness ||
    typeof effectiveness !== 'object' ||
    Array.isArray(effectiveness)
  ) {
    return null;
  }
  const rate = (effectiveness as { observedSuccessRate?: unknown })
    .observedSuccessRate;
  if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
  return formatPercent(rate);
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatConfidence(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (value <= 1) return formatPercent(value);
  return String(Math.round(value));
}

export function summarizeBehavior(behavior: AiBehaviorConfig | null): string {
  if (!behavior) return '—';
  return [
    `Sales guidance: ${behavior.injectSalesGuidance}`,
    `Reply style: ${behavior.replyStyle}`,
    `CTA style: ${behavior.ctaStyle}`,
  ].join(' · ');
}

export function controlLabel(controlWasImplicit: boolean): string {
  return controlWasImplicit ? 'Default' : 'Current production';
}

export function startBlockedReason(
  optimization: 'off' | 'on' | undefined
): string | null {
  if (optimization !== 'on') return START_FLAG_OFF_COPY;
  return null;
}

export function canStart(status: string): boolean {
  return status === 'draft';
}

export function canApprove(
  experiment: Pick<ExperimentRow, 'status' | 'candidate_winner_version_id'>
): boolean {
  return (
    experiment.status === 'evaluating' &&
    Boolean(experiment.candidate_winner_version_id)
  );
}

export function canRollback(status: string): boolean {
  return (
    status === 'running' || status === 'evaluating' || status === 'approved'
  );
}

export function hasCandidate(
  experiment: Pick<ExperimentRow, 'candidate_winner_version_id'>
): boolean {
  return Boolean(experiment.candidate_winner_version_id);
}

export function eligibleOutcomesFromEvaluation(
  evaluation: ExperimentRow['evaluation']
): number | null {
  if (!evaluation?.control || !evaluation.variant) return null;
  return (
    evaluation.control.eligibleOutcomeCount +
    evaluation.variant.eligibleOutcomeCount
  );
}

export function observedResultLabel(
  evaluation: ExperimentRow['evaluation'],
  candidateWinnerVersionId: string | null
): string {
  if (candidateWinnerVersionId) return CANDIDATE_COPY;
  const lift = formatImprovement(evaluation?.observedImprovement ?? null);
  if (lift) return lift;
  return '—';
}

export function countOrEmpty(available: boolean, value: number): string {
  if (!available) return UNAVAILABLE_COPY;
  if (value <= 0) return NO_DATA_COPY;
  return String(value);
}
