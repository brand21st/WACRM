/**
 * Phase 6 observational effectiveness constants and formulas.
 * No LLM. No causal claims.
 */

export const EFFECTIVENESS_ANALYZER_VERSION = 'v1'

export const ATTRIBUTION_WINDOW_DAYS = 7
export const MAX_USAGES_PER_ACCOUNT = 2000
export const MIN_EFFECTIVENESS_ELIGIBLE = 5
export const POOR_SUCCESS_RATE = 0.25

export const EFFECTIVENESS_SUCCESS_TYPES = new Set([
  'ORDER_CREATED',
  'PAYMENT_COMPLETED',
])

export const EFFECTIVENESS_FAILURE_TYPES = new Set([
  'ORDER_CANCELLED',
  'CHECKOUT_ABANDONED',
])

export type AttributionStatus = 'unresolved' | 'success' | 'failure'

export type SalesPatternEffectivenessMode = 'off' | 'shadow' | 'on'

export type PatternEffectiveness = {
  usageCount: number
  eligibleUsageCount: number
  successCount: number
  failureCount: number
  unresolvedCount: number
  observedSuccessRate: number | null
  firstUsedAt: string | null
  lastUsedAt: string | null
}

export function observedSuccessRate(
  successCount: number,
  failureCount: number
): number | null {
  const eligible = successCount + failureCount
  if (eligible <= 0) return null
  return successCount / eligible
}

export function nextRetrievalEligible(args: {
  eligibleUsageCount: number
  observedSuccessRate: number | null
  currentEligible: boolean
}): boolean {
  if (args.eligibleUsageCount < MIN_EFFECTIVENESS_ELIGIBLE) {
    return args.currentEligible
  }
  const rate = args.observedSuccessRate
  if (rate == null) return args.currentEligible
  return rate >= POOR_SUCCESS_RATE
}

export function isTerminalOutcomeType(eventType: string): boolean {
  return (
    EFFECTIVENESS_SUCCESS_TYPES.has(eventType) ||
    EFFECTIVENESS_FAILURE_TYPES.has(eventType)
  )
}

export function attributionFromEventType(
  eventType: string
): AttributionStatus {
  if (EFFECTIVENESS_SUCCESS_TYPES.has(eventType)) return 'success'
  if (EFFECTIVENESS_FAILURE_TYPES.has(eventType)) return 'failure'
  return 'unresolved'
}

export function attributionWindowEnd(usedAt: string, now = new Date()): Date {
  const start = Date.parse(usedAt)
  if (!Number.isFinite(start)) return now
  return new Date(start + ATTRIBUTION_WINDOW_DAYS * 24 * 60 * 60 * 1000)
}

export function effectivenessIdempotencyKey(accountId: string): string {
  return `${accountId.trim()}:effectiveness`
}
