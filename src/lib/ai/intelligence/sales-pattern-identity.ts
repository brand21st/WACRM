/**
 * Deterministic pattern identity and context normalization.
 * No timestamps, language, color, or size in the key.
 */

import type { PatternContext, SalesPatternType } from './sales-pattern-types'

export const PRICE_BANDS = [
  '0-999',
  '1000-2999',
  '3000-4999',
  '5000-9999',
  '10000+',
] as const

export type PriceBand = (typeof PRICE_BANDS)[number]

export function priceBandForAmount(amount: number | null | undefined): PriceBand | undefined {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return undefined
  if (amount < 1000) return '0-999'
  if (amount < 3000) return '1000-2999'
  if (amount < 5000) return '3000-4999'
  if (amount < 10000) return '5000-9999'
  return '10000+'
}

export function normalizeContextToken(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().slice(0, 80)
}

export function buildPatternKey(args: {
  accountId: string
  patternType: SalesPatternType
  triggerEventType: SalesPatternType
  context: PatternContext
}): string {
  return [
    args.accountId.trim(),
    args.patternType,
    args.triggerEventType,
    normalizeContextToken(args.context.category),
    args.context.priceBand ?? '',
    args.context.productId ?? '',
  ].join('|')
}

export function contextSource(context: PatternContext): string {
  const parts = [
    context.category ? `category:${context.category}` : null,
    context.priceBand ? `priceBand:${context.priceBand}` : null,
    context.budgetBand ? `budgetBand:${context.budgetBand}` : null,
    context.productId ? `productId:${context.productId}` : null,
  ].filter(Boolean)
  return parts.join(',')
}

export function sanitizePatternContext(raw: PatternContext): PatternContext {
  const category = normalizeContextToken(raw.category)
  const out: PatternContext = {}
  if (category) out.category = category
  if (raw.priceBand && (PRICE_BANDS as readonly string[]).includes(raw.priceBand)) {
    out.priceBand = raw.priceBand
  }
  if (raw.budgetBand && (PRICE_BANDS as readonly string[]).includes(raw.budgetBand)) {
    out.budgetBand = raw.budgetBand
  }
  if (raw.productId?.trim()) out.productId = raw.productId.trim().slice(0, 80)
  return out
}
