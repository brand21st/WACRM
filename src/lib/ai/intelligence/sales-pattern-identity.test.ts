import { describe, expect, it } from 'vitest'
import {
  buildPatternKey,
  contextSource,
  priceBandForAmount,
  sanitizePatternContext,
} from './sales-pattern-identity'

describe('priceBandForAmount', () => {
  it('maps known bands and drops invalid amounts', () => {
    expect(priceBandForAmount(0)).toBe('0-999')
    expect(priceBandForAmount(999)).toBe('0-999')
    expect(priceBandForAmount(1000)).toBe('1000-2999')
    expect(priceBandForAmount(4500)).toBe('3000-4999')
    expect(priceBandForAmount(8000)).toBe('5000-9999')
    expect(priceBandForAmount(12000)).toBe('10000+')
    expect(priceBandForAmount(-1)).toBeUndefined()
    expect(priceBandForAmount(undefined)).toBeUndefined()
  })
})

describe('buildPatternKey', () => {
  it('is deterministic and omits timestamps', () => {
    const key = buildPatternKey({
      accountId: 'acct-a',
      patternType: 'PRICE_OBJECTION',
      triggerEventType: 'PRICE_OBJECTION',
      context: { category: 'Kurti', priceBand: '3000-4999' },
    })
    expect(key).toBe('acct-a|PRICE_OBJECTION|PRICE_OBJECTION|kurti|3000-4999|')
    expect(key).toBe(
      buildPatternKey({
        accountId: 'acct-a',
        patternType: 'PRICE_OBJECTION',
        triggerEventType: 'PRICE_OBJECTION',
        context: { category: 'kurti', priceBand: '3000-4999' },
      }),
    )
  })

  it('includes productId only when provided', () => {
    expect(
      buildPatternKey({
        accountId: 'acct-a',
        patternType: 'PRODUCT_INQUIRY',
        triggerEventType: 'PRODUCT_INQUIRY',
        context: { productId: 'prod-1' },
      }),
    ).toBe('acct-a|PRODUCT_INQUIRY|PRODUCT_INQUIRY|||prod-1')
  })
})

describe('sanitizePatternContext', () => {
  it('keeps category and price band, drops unknown bands', () => {
    expect(
      sanitizePatternContext({
        category: '  Saree  ',
        priceBand: 'not-a-band',
        productId: 'prod-9',
      }),
    ).toEqual({ category: 'saree', productId: 'prod-9' })
  })
})

describe('contextSource', () => {
  it('serializes structured context without PII', () => {
    expect(
      contextSource({ category: 'kurti', priceBand: '3000-4999' }),
    ).toBe('category:kurti,priceBand:3000-4999')
  })
})
