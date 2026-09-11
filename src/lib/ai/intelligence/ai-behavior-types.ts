/**
 * Phase 7 controlled-optimization constants and formulas.
 * No LLM. No causal claims. No automatic promotion.
 */

export const AI_BEHAVIOR_ANALYZER_VERSION = 'v1'

export const ATTRIBUTION_WINDOW_DAYS = 7
export const MIN_EXPERIMENT_ASSIGNMENTS = 40
export const MIN_EXPERIMENT_ELIGIBLE_OUTCOMES_PER_ARM = 15
export const MIN_ABSOLUTE_LIFT = 0.05
export const MIN_RUNNING_DAYS = 7
export const GUARDRAIL_FAILURE_RATE_DELTA = 0.1
export const MAX_ASSIGNMENTS_PER_ACCOUNT = 4000

export const SUCCESS_OUTCOME_TYPES = new Set([
  'ORDER_CREATED',
  'PAYMENT_COMPLETED',
])

export const FAILURE_OUTCOME_TYPES = new Set([
  'ORDER_CANCELLED',
  'CHECKOUT_ABANDONED',
])

export const FUNNEL_SIGNAL_TYPES = new Set([
  'CART_CREATED',
  'CHECKOUT_STARTED',
])

export type AiBehaviorOptimizationMode = 'off' | 'on'
export type AttributionStatus = 'unresolved' | 'success' | 'failure'
export type AssignedVariant = 'control' | 'variant'
export type BehaviorVersionStatus = 'draft' | 'active' | 'archived'
export type ExperimentStatus =
  | 'draft'
  | 'running'
  | 'evaluating'
  | 'approved'
  | 'rolled_back'
  | 'archived'

export type InjectSalesGuidance = 'inherit' | 'omit'
export type ReplyStyle = 'default' | 'concise' | 'discovery'
export type CtaStyle = 'default' | 'softer' | 'direct'

export type AiBehaviorConfig = {
  injectSalesGuidance: InjectSalesGuidance
  replyStyle: ReplyStyle
  ctaStyle: CtaStyle
}

export const IMPLICIT_DEFAULT_BEHAVIOR: AiBehaviorConfig = {
  injectSalesGuidance: 'inherit',
  replyStyle: 'default',
  ctaStyle: 'default',
}

export type ArmMetrics = {
  assignedCount: number
  eligibleOutcomeCount: number
  successCount: number
  failureCount: number
  unresolvedCount: number
  observedSuccessRate: number | null
  failureRate: number | null
}

export type ExperimentEvaluation = {
  control: ArmMetrics
  variant: ArmMetrics
  observedImprovement: number | null
  candidateWinnerVersionId: string | null
  reason: string
}

export function emptyArmMetrics(): ArmMetrics {
  return {
    assignedCount: 0,
    eligibleOutcomeCount: 0,
    successCount: 0,
    failureCount: 0,
    unresolvedCount: 0,
    observedSuccessRate: null,
    failureRate: null,
  }
}

export function observedSuccessRate(
  successCount: number,
  failureCount: number
): number | null {
  const eligible = successCount + failureCount
  if (eligible <= 0) return null
  return successCount / eligible
}

export function observedFailureRate(
  successCount: number,
  failureCount: number
): number | null {
  const eligible = successCount + failureCount
  if (eligible <= 0) return null
  return failureCount / eligible
}

export function isTerminalOutcomeType(eventType: string): boolean {
  return (
    SUCCESS_OUTCOME_TYPES.has(eventType) ||
    FAILURE_OUTCOME_TYPES.has(eventType)
  )
}

export function attributionFromEventType(
  eventType: string
): AttributionStatus {
  if (SUCCESS_OUTCOME_TYPES.has(eventType)) return 'success'
  if (FAILURE_OUTCOME_TYPES.has(eventType)) return 'failure'
  return 'unresolved'
}

export function attributionWindowEnd(assignedAt: string, now = new Date()): Date {
  const start = Date.parse(assignedAt)
  if (!Number.isFinite(start)) return now
  return new Date(start + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

export function runningDays(startedAt: string | null, now = new Date()): number {
  if (!startedAt) return 0
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return 0
  return (now.getTime() - start) / (24 * 60 * 60 * 1000)
}

export function optimizationIdempotencyKey(accountId: string): string {
  return `${accountId.trim()}:ai-behavior-optimization`
}

export function decideExperimentOutcome(args: {
  control: ArmMetrics
  variant: ArmMetrics
  startedAt: string | null
  variantVersionId: string
  now?: Date
}): {
  nextStatus: 'running' | 'evaluating'
  candidateWinnerVersionId: string | null
  observedImprovement: number | null
  reason: string
} {
  const now = args.now ?? new Date()
  const assigned =
    args.control.assignedCount + args.variant.assignedCount
  const days = runningDays(args.startedAt, now)

  if (
    assigned < MIN_EXPERIMENT_ASSIGNMENTS ||
    args.control.eligibleOutcomeCount < MIN_EXPERIMENT_ELIGIBLE_OUTCOMES_PER_ARM ||
    args.variant.eligibleOutcomeCount < MIN_EXPERIMENT_ELIGIBLE_OUTCOMES_PER_ARM ||
    days < MIN_RUNNING_DAYS
  ) {
    return {
      nextStatus: 'running',
      candidateWinnerVersionId: null,
      observedImprovement: null,
      reason: 'insufficient_evidence',
    }
  }

  if (
    args.control.eligibleOutcomeCount <= 0 ||
    args.variant.eligibleOutcomeCount <= 0
  ) {
    return {
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      observedImprovement: null,
      reason: 'malformed_or_zero_eligible',
    }
  }

  const controlRate = args.control.observedSuccessRate
  const variantRate = args.variant.observedSuccessRate
  const controlFail = args.control.failureRate
  const variantFail = args.variant.failureRate
  if (
    controlRate == null ||
    variantRate == null ||
    controlFail == null ||
    variantFail == null
  ) {
    return {
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      observedImprovement: null,
      reason: 'malformed_metrics',
    }
  }

  if (variantFail > controlFail + GUARDRAIL_FAILURE_RATE_DELTA) {
    return {
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      observedImprovement: variantRate - controlRate,
      reason: 'guardrail_failure_rate',
    }
  }

  const lift = variantRate - controlRate
  if (variantRate <= controlRate || lift < MIN_ABSOLUTE_LIFT) {
    return {
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      observedImprovement: lift,
      reason: 'no_observed_improvement',
    }
  }

  return {
    nextStatus: 'evaluating',
    candidateWinnerVersionId: args.variantVersionId,
    observedImprovement: lift,
    reason: 'observed_improvement',
  }
}
