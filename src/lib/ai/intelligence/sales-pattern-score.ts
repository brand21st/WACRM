/**
 * Deterministic Phase 5 scoring and turn → pattern mapping.
 * No database, no LLM, no feature-flag policy.
 */

import { languagePickerCode } from '@/lib/ai/language-picker'
import type { ShoppingContext } from '@/lib/catalog/intelligence/types'
import type { SalesTurn } from '@/lib/shopify/sales-turn'
import { normalizeContextToken, priceBandForAmount } from './sales-pattern-identity'
import type {
  PatternContext,
  SalesPatternType,
} from './sales-pattern-types'
import { SALES_PATTERN_TYPES } from './sales-pattern-types'

export const MIN_MATCH_SCORE = 25
export const MAX_RETURNED_PATTERNS = 3
export const CANDIDATE_QUERY_LIMIT = 40
export const RECENCY_DAYS = 30

/** Price words already used by classifySalesTurn SUBSTITUTION. Mapping only. */
const PRICE_HINT =
  /\b(too expensive|cheaper|less expensive|lower price|more affordable)\b|വില\s*കൂടി|കുറഞ്ഞ\s*വില/i

export type SalesPatternSituation = {
  patternType: SalesPatternType
  category?: string
  priceBand?: string
  budgetBand?: string
  productId?: string
}

export type ScoreablePattern = {
  patternType: string
  triggerEventType: string
  context: PatternContext
  eligibleOutcomeCount: number
  confidence: number
  lastObservedAt: string | null
}

export type PatternScore = {
  score: number
  matchReasons: string[]
  typeMatched: boolean
  contextMatched: boolean
}

export function isSalesPatternType(value: string): value is SalesPatternType {
  return (SALES_PATTERN_TYPES as readonly string[]).includes(value)
}

/**
 * Map an existing sales-turn classification into the Phase 4 taxonomy.
 * Returns null for greetings, stay, language-picker, and preference-only turns.
 */
export function mapSalesTurnToPatternType(
  salesTurn: SalesTurn,
  queryText?: string | null
): SalesPatternType | null {
  if (languagePickerCode(queryText)) return null

  switch (salesTurn.kind) {
    case 'purchase':
      return 'PURCHASE_INTENT'
    case 'substitution':
      return PRICE_HINT.test(queryText ?? '')
        ? 'PRICE_OBJECTION'
        : 'PRODUCT_OBJECTION'
    case 'product_switch':
      return 'PRODUCT_OBJECTION'
    case 'comparison':
      return 'PRODUCT_COMPARISON'
    case 'product_question':
    case 'variant_change':
      return 'PRODUCT_INQUIRY'
    case 'budget_change':
      return 'PRICE_OBJECTION'
    case 'preference_change':
    case 'stay':
      return null
    default:
      return null
  }
}

export function shouldRetrieveSalesPatterns(
  salesTurn: SalesTurn,
  queryText?: string | null
): boolean {
  return mapSalesTurnToPatternType(salesTurn, queryText) != null
}

export function situationFromTurn(args: {
  salesTurn: SalesTurn
  queryText?: string | null
  shopping?: ShoppingContext | null
  productId?: string | null
}): SalesPatternSituation | null {
  const patternType = mapSalesTurnToPatternType(args.salesTurn, args.queryText)
  if (!patternType) return null

  const category = normalizeContextToken(args.shopping?.categoryHint) || undefined
  const band = priceBandForAmount(args.shopping?.maxPrice)
  const productId =
    args.productId?.trim() || args.shopping?.selectedIds[0]?.trim() || undefined

  return {
    patternType,
    category,
    priceBand: band,
    budgetBand: band,
    productId,
  }
}

export function scoreSalesPattern(
  row: ScoreablePattern,
  situation: SalesPatternSituation,
  now = new Date()
): PatternScore {
  let score = 0
  const matchReasons: string[] = []

  const typeMatched =
    row.patternType === situation.patternType ||
    row.triggerEventType === situation.patternType

  if (typeMatched) {
    score += 40
    matchReasons.push('patternType')
  } else if (
    row.patternType === 'GENERAL_SALES' &&
    situation.patternType === 'GENERAL_SALES'
  ) {
    score += 12
    matchReasons.push('generalSales')
  }

  const rowCategory = normalizeContextToken(row.context.category)
  if (situation.category && rowCategory && situation.category === rowCategory) {
    score += 15
    matchReasons.push('category')
  }

  const situationBand = situation.priceBand || situation.budgetBand
  const rowBand = row.context.priceBand || row.context.budgetBand
  if (situationBand && rowBand && situationBand === rowBand) {
    score += 10
    matchReasons.push('priceBand')
  }

  if (
    situation.productId &&
    row.context.productId &&
    situation.productId === row.context.productId
  ) {
    score += 8
    matchReasons.push('productId')
  }

  const evidence = Math.min(20, Math.max(0, row.eligibleOutcomeCount))
  if (evidence > 0) {
    score += evidence
    matchReasons.push('evidence')
  }

  const confidence = clamp01(row.confidence)
  if (confidence > 0) {
    score += confidence * 10
    matchReasons.push('confidence')
  }

  if (isRecent(row.lastObservedAt, now)) {
    score += 3
    matchReasons.push('recency')
  }

  return {
    score,
    matchReasons,
    typeMatched,
    contextMatched:
      matchReasons.includes('category') ||
      matchReasons.includes('priceBand') ||
      matchReasons.includes('productId'),
  }
}

export function isEligibleMatch(result: PatternScore): boolean {
  if (!result.typeMatched && !result.contextMatched) return false
  return result.score >= MIN_MATCH_SCORE
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

function isRecent(lastObservedAt: string | null, now: Date): boolean {
  if (!lastObservedAt) return false
  const observed = Date.parse(lastObservedAt)
  if (!Number.isFinite(observed)) return false
  const ageMs = now.getTime() - observed
  return ageMs >= 0 && ageMs <= RECENCY_DAYS * 24 * 60 * 60 * 1000
}
