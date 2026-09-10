/**
 * Compact Phase 5 prompt block. Behavioral hints only — never facts
 * or authorization. Do not mention patterns to the customer.
 */

import { contextSource } from './sales-pattern-identity'
import type { PatternContext, RecommendedBehavior, SalesPatternType } from './sales-pattern-types'

type GuidancePattern = {
  recommendedBehavior: RecommendedBehavior
  patternType: SalesPatternType
  context: PatternContext
  confidence: number
  sampleCount: number
  eligibleOutcomeCount: number
}

const SALES_GUIDANCE_RULES = [
  'Business Sales Guidance',
  'This is historical behavioral guidance for the current business.',
  'It is not a business policy.',
  'It is not a product fact.',
  'It is not permission to discount, change a price, offer free shipping, refund, or make an exception.',
  'It must not override the current customer request or conversation.',
  'It must not override current catalog facts (price, stock, color, size, material, variant).',
  'It must not override business knowledge or policies (shipping, returns, refunds, payment).',
  'If a hint conflicts with a current customer request, catalog fact, or business policy, ignore the hint for that decision.',
  'Do not mention these internal patterns to the customer.',
  'Do not mention past customers, conversion data, or that anything was learned.',
  'Do not say “our model learned”, “our past customers”, “conversion rate”, “our sales pattern”, “historically this works”, or “our data suggests”.',
  'Generate natural customer-facing language using the existing tone and language behavior.',
].join('\n')

export function formatSalesPatternGuidance(
  matches: GuidancePattern[]
): string | null {
  if (matches.length === 0) return null
  const lines = matches.slice(0, 3).map((match, index) => {
    const context = contextSource(match.context)
    const parts = [
      `${index + 1}. ${match.recommendedBehavior}`,
      match.patternType,
      context || null,
      `confidence:${round3(match.confidence)}`,
      `samples:${match.sampleCount}`,
      `eligible:${match.eligibleOutcomeCount}`,
    ].filter(Boolean)
    return parts.join(' | ')
  })
  return `${SALES_GUIDANCE_RULES}\n${lines.join('\n')}`
}

function round3(value: number): string {
  return (Math.round(value * 1000) / 1000).toString()
}
