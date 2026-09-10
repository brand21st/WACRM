/**
 * Phase 4 v1 sales-pattern taxonomy and evidence thresholds.
 *
 * Live auto-reply does not read these types. Phase 5 will retrieve
 * tenant-scoped rows from `sales_patterns`.
 */

export const PATTERN_ANALYZER_VERSION = 'v1'

export const MIN_CANDIDATE_SAMPLES = 3
export const MIN_ACTIVE_SAMPLES = 8
export const MIN_ACTIVE_ELIGIBLE = 5
export const STALE_DAYS = 90
export const ARCHIVE_DAYS = 180
export const PRODUCT_SPECIALIZE_MIN = 8
export const MAX_EVENTS_PER_ACCOUNT = 5000
export const MAX_PATTERNS_PER_ACCOUNT = 80
export const ACCOUNTS_PER_CRON = 8
export const CATALOG_PRICE_LOOKUP_CAP = 200

export const SALES_PATTERN_TYPES = [
  'PRICE_OBJECTION',
  'PRODUCT_OBJECTION',
  'PRODUCT_COMPARISON',
  'PURCHASE_INTENT',
  'PRODUCT_INQUIRY',
  'DISCOUNT_REQUEST',
  'SHIPPING_CONCERN',
  'RETURN_CONCERN',
  'GENERAL_SALES',
] as const

export type SalesPatternType = (typeof SALES_PATTERN_TYPES)[number]

export const SALES_PATTERN_STATUSES = [
  'candidate',
  'active',
  'stale',
  'archived',
] as const

export type SalesPatternStatus = (typeof SALES_PATTERN_STATUSES)[number]

export const RECOMMENDED_BEHAVIORS = [
  'OFFER_RELEVANT_ALTERNATIVE',
  'SHOW_ALTERNATIVES',
  'COMPARE_PRODUCTS',
  'CONFIRM_AND_CHECKOUT',
  'ANSWER_THEN_OFFER',
  'EXPLAIN_VALUE_BEFORE_DISCOUNT',
  'EXPLAIN_SHIPPING',
  'EXPLAIN_RETURNS',
  'CONTINUE_DISCOVERY',
] as const

export type RecommendedBehavior = (typeof RECOMMENDED_BEHAVIORS)[number]

export const SUCCESS_OUTCOME_TYPES = new Set(['ORDER_CREATED', 'PAYMENT_COMPLETED'])
export const FAILURE_OUTCOME_TYPES = new Set(['ORDER_CANCELLED', 'CHECKOUT_ABANDONED'])

export const SPECIFIC_SIGNAL_MAP: Record<string, SalesPatternType> = {
  PRICE_OBJECTION: 'PRICE_OBJECTION',
  PRODUCT_OBJECTION: 'PRODUCT_OBJECTION',
  PRODUCT_COMPARISON: 'PRODUCT_COMPARISON',
  PURCHASE_INTENT: 'PURCHASE_INTENT',
  READY_TO_BUY: 'PURCHASE_INTENT',
  HIGH_INTENT: 'PURCHASE_INTENT',
  PRODUCT_INQUIRY: 'PRODUCT_INQUIRY',
  PRICE_INQUIRY: 'PRODUCT_INQUIRY',
  AVAILABILITY_INQUIRY: 'PRODUCT_INQUIRY',
  SIZE_INQUIRY: 'PRODUCT_INQUIRY',
  COLOR_INQUIRY: 'PRODUCT_INQUIRY',
  DISCOUNT_REQUEST: 'DISCOUNT_REQUEST',
  SHIPPING_INQUIRY: 'SHIPPING_CONCERN',
  RETURN_INQUIRY: 'RETURN_CONCERN',
  REFUND_INQUIRY: 'RETURN_CONCERN',
}

export const GENERIC_SIGNAL_TYPES = new Set([
  'CUSTOMER_INTENT',
  'INTERESTED',
  'HESITATION',
  'OBJECTION',
  'NEEDS_MORE_INFORMATION',
])

export const BEHAVIOR_FOR_PATTERN: Record<SalesPatternType, RecommendedBehavior> = {
  PRICE_OBJECTION: 'OFFER_RELEVANT_ALTERNATIVE',
  PRODUCT_OBJECTION: 'SHOW_ALTERNATIVES',
  PRODUCT_COMPARISON: 'COMPARE_PRODUCTS',
  PURCHASE_INTENT: 'CONFIRM_AND_CHECKOUT',
  PRODUCT_INQUIRY: 'ANSWER_THEN_OFFER',
  DISCOUNT_REQUEST: 'EXPLAIN_VALUE_BEFORE_DISCOUNT',
  SHIPPING_CONCERN: 'EXPLAIN_SHIPPING',
  RETURN_CONCERN: 'EXPLAIN_RETURNS',
  GENERAL_SALES: 'CONTINUE_DISCOVERY',
}

export type ConversationOutcome = 'success' | 'failure' | 'unresolved'

export interface PatternContext {
  category?: string
  priceBand?: string
  productId?: string
  budgetBand?: string
}

export interface PatternEvidence {
  signalCount: number
  outcomeCount: number
  successRate: number | null
  firstObservedAt: string | null
  lastObservedAt: string | null
}

export interface AggregatedPattern {
  accountId: string
  patternKey: string
  patternType: SalesPatternType
  triggerEventType: SalesPatternType
  context: PatternContext
  recommendedBehavior: RecommendedBehavior
  evidence: PatternEvidence
  confidence: number
  sampleCount: number
  successCount: number
  failureCount: number
  eligibleOutcomeCount: number
  unresolvedCount: number
  status: SalesPatternStatus
  firstObservedAt: string | null
  lastObservedAt: string | null
}

export function mapSignalToPatternType(eventType: string): SalesPatternType | null {
  return SPECIFIC_SIGNAL_MAP[eventType] ?? null
}

export function isGenericSignal(eventType: string): boolean {
  return GENERIC_SIGNAL_TYPES.has(eventType)
}

export function behaviorFor(type: SalesPatternType): RecommendedBehavior {
  return BEHAVIOR_FOR_PATTERN[type]
}

export function patternDiscoverIdempotencyKey(accountId: string): string {
  return `${accountId.trim()}:patterns`
}
