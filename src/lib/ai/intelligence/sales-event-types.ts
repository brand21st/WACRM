/**
 * Phase 3 v1 sales-event taxonomy.
 *
 * Live auto-reply does not read these types. Phase 4 will aggregate
 * tenant-scoped outcomes from persisted `sales_events` rows.
 */

export const ANALYZER_VERSION = 'v1'

export const SALES_EVENT_KINDS = ['signal', 'outcome'] as const
export type SalesEventKind = (typeof SALES_EVENT_KINDS)[number]

/** Commerce / catalog / interactive structured types we can emit without an LLM. */
export const DETERMINISTIC_EVENT_TYPES = [
  'PRODUCT_SELECTED',
  'VARIANT_SELECTED',
  'CART_CREATED',
  'CHECKOUT_STARTED',
  'ORDER_CREATED',
  'PAYMENT_COMPLETED',
  'ORDER_CANCELLED',
  'CHECKOUT_ABANDONED',
  'HUMAN_TAKEOVER',
  'PURCHASE_INTENT',
  'READY_TO_BUY',
  'PRICE_OBJECTION',
  'PRODUCT_OBJECTION',
  'PRODUCT_COMPARISON',
  'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY',
  'SIZE_INQUIRY',
  'COLOR_INQUIRY',
  'PRODUCT_INQUIRY',
] as const

/** LLM-only types. TRUST_CONCERN is accepted only at confidence ≥ 0.7. */
export const LLM_EVENT_TYPES = [
  'CUSTOMER_INTENT',
  'HESITATION',
  'OBJECTION',
  'DISCOUNT_REQUEST',
  'SHIPPING_INQUIRY',
  'RETURN_INQUIRY',
  'REFUND_INQUIRY',
  'PAYMENT_INQUIRY',
  'NEEDS_MORE_INFORMATION',
  'HIGH_INTENT',
  'INTERESTED',
  'TRUST_CONCERN',
] as const

export const SALES_EVENT_TYPES = [
  ...DETERMINISTIC_EVENT_TYPES,
  ...LLM_EVENT_TYPES,
] as const

export type DeterministicEventType = (typeof DETERMINISTIC_EVENT_TYPES)[number]
export type LlmEventType = (typeof LLM_EVENT_TYPES)[number]
export type SalesEventV1Type = (typeof SALES_EVENT_TYPES)[number]

/** Verified commerce / catalog rows only. Everything else is a signal. */
export const OUTCOME_EVENT_TYPES = new Set<SalesEventV1Type>([
  'CART_CREATED',
  'CHECKOUT_STARTED',
  'ORDER_CREATED',
  'PAYMENT_COMPLETED',
  'ORDER_CANCELLED',
  'CHECKOUT_ABANDONED',
])

export const ALLOWED_METADATA_KEYS = [
  'productId',
  'variantId',
  'budgetMax',
  'color',
  'size',
  'category',
  'objectionType',
] as const

export type SalesEventMetadataKey = (typeof ALLOWED_METADATA_KEYS)[number]

export type SalesEventMetadata = Partial<{
  productId: string
  variantId: string
  budgetMax: number
  color: string
  size: string
  category: string
  objectionType: string
}>

export function isSalesEventV1Type(value: unknown): value is SalesEventV1Type {
  return (
    typeof value === 'string' &&
    (SALES_EVENT_TYPES as readonly string[]).includes(value)
  )
}

export function kindForEventType(
  type: SalesEventV1Type,
  source: 'commerce' | 'catalog' | 'nl' | 'llm' | 'shopping' | 'conversation',
): SalesEventKind {
  if (source === 'commerce' || source === 'catalog') {
    return OUTCOME_EVENT_TYPES.has(type) ? 'outcome' : 'signal'
  }
  return 'signal'
}
