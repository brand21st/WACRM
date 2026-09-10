import { describe, expect, it } from 'vitest'
import { classifySalesTurn } from '@/lib/shopify/sales-turn'
import { LANGUAGE_PICKER_IDS } from '@/lib/ai/language-picker'
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context'
import {
  MIN_MATCH_SCORE,
  isEligibleMatch,
  mapSalesTurnToPatternType,
  scoreSalesPattern,
  shouldRetrieveSalesPatterns,
  situationFromTurn,
  type ScoreablePattern,
} from './sales-pattern-score'

function row(partial: Partial<ScoreablePattern>): ScoreablePattern {
  return {
    patternType: 'PRICE_OBJECTION',
    triggerEventType: 'PRICE_OBJECTION',
    context: {},
    eligibleOutcomeCount: 0,
    confidence: 0,
    lastObservedAt: null,
    ...partial,
  }
}

describe('mapSalesTurnToPatternType', () => {
  it('maps purchase intent', () => {
    expect(mapSalesTurnToPatternType(classifySalesTurn("I'll take this"))).toBe(
      'PURCHASE_INTENT'
    )
  })

  it('maps substitution plus price words to PRICE_OBJECTION', () => {
    const turn = classifySalesTurn('too expensive')
    expect(turn.kind).toBe('substitution')
    expect(mapSalesTurnToPatternType(turn, 'too expensive')).toBe(
      'PRICE_OBJECTION'
    )
    expect(mapSalesTurnToPatternType(turn, 'cheaper please')).toBe(
      'PRICE_OBJECTION'
    )
    expect(mapSalesTurnToPatternType(turn, 'വില കൂടി')).toBe('PRICE_OBJECTION')
  })

  it('maps non-price substitution to PRODUCT_OBJECTION', () => {
    const turn = classifySalesTurn('show similar')
    expect(turn.kind).toBe('substitution')
    expect(mapSalesTurnToPatternType(turn, 'show similar')).toBe(
      'PRODUCT_OBJECTION'
    )
    expect(mapSalesTurnToPatternType(turn, 'show alternative')).toBe(
      'PRODUCT_OBJECTION'
    )
  })

  it('maps product switch, comparison, and inquiry turns', () => {
    expect(mapSalesTurnToPatternType(classifySalesTurn("don't want this"))).toBe(
      'PRODUCT_OBJECTION'
    )
    expect(
      mapSalesTurnToPatternType(classifySalesTurn('which is better'))
    ).toBe('PRODUCT_COMPARISON')
    expect(
      mapSalesTurnToPatternType(
        classifySalesTurn('what material is this?', { hasFocus: true }),
        'what material is this?'
      )
    ).toBe('PRODUCT_INQUIRY')
    expect(
      mapSalesTurnToPatternType(
        classifySalesTurn('another color', { hasFocus: true }),
        'another color'
      )
    ).toBe('PRODUCT_INQUIRY')
    expect(mapSalesTurnToPatternType(classifySalesTurn('under 3k'))).toBe(
      'PRICE_OBJECTION'
    )
  })

  it('skips stay, greeting, show-more, language-picker, and preference', () => {
    expect(mapSalesTurnToPatternType(classifySalesTurn('hi'))).toBeNull()
    expect(mapSalesTurnToPatternType(classifySalesTurn('ok'))).toBeNull()
    expect(mapSalesTurnToPatternType(classifySalesTurn('nice'))).toBeNull()
    expect(
      mapSalesTurnToPatternType(classifySalesTurn('wacrm:show_more'))
    ).toBeNull()
    expect(
      mapSalesTurnToPatternType(
        classifySalesTurn('hello'),
        `[Customer tapped "Malayalam" (action: ${LANGUAGE_PICKER_IDS.ml})]`
      )
    ).toBeNull()
    expect(mapSalesTurnToPatternType(classifySalesTurn('I prefer red'))).toBeNull()
    expect(shouldRetrieveSalesPatterns(classifySalesTurn('hi'))).toBe(false)
  })
})

describe('scoreSalesPattern', () => {
  const now = new Date('2026-09-10T00:00:00.000Z')

  it('scores exact type, category, price band, product, evidence, confidence, recency', () => {
    const result = scoreSalesPattern(
      row({
        context: {
          category: 'saree',
          priceBand: '1000-2999',
          productId: 'p-red',
        },
        eligibleOutcomeCount: 12,
        confidence: 0.8,
        lastObservedAt: '2026-09-01T00:00:00.000Z',
      }),
      {
        patternType: 'PRICE_OBJECTION',
        category: 'saree',
        priceBand: '1000-2999',
        productId: 'p-red',
      },
      now
    )
    expect(result.score).toBe(40 + 15 + 10 + 8 + 12 + 8 + 3)
    expect(result.matchReasons).toEqual([
      'patternType',
      'category',
      'priceBand',
      'productId',
      'evidence',
      'confidence',
      'recency',
    ])
    expect(isEligibleMatch(result)).toBe(true)
  })

  it('lets a strong category pattern beat a weak product-specific pattern', () => {
    const situation = {
      patternType: 'PRICE_OBJECTION' as const,
      category: 'saree',
      productId: 'p-red',
    }
    const productSpecific = scoreSalesPattern(
      row({
        context: { productId: 'p-red' },
        eligibleOutcomeCount: 5,
        confidence: 0,
      }),
      situation,
      now
    )
    const categoryStrong = scoreSalesPattern(
      row({
        context: { category: 'saree' },
        eligibleOutcomeCount: 50,
        confidence: 0,
      }),
      situation,
      now
    )
    expect(productSpecific.score).toBe(40 + 8 + 5)
    expect(categoryStrong.score).toBe(40 + 15 + 20)
    expect(categoryStrong.score).toBeGreaterThan(productSpecific.score)
  })

  it('excludes unrelated types with no context overlap', () => {
    const result = scoreSalesPattern(
      row({
        patternType: 'PRODUCT_COMPARISON',
        triggerEventType: 'PRODUCT_COMPARISON',
        eligibleOutcomeCount: 50,
        confidence: 1,
      }),
      { patternType: 'PRICE_OBJECTION' },
      now
    )
    expect(result.typeMatched).toBe(false)
    expect(result.contextMatched).toBe(false)
    expect(isEligibleMatch(result)).toBe(false)
  })

  it('drops scores below the minimum even with a weak context overlap', () => {
    const result = scoreSalesPattern(
      row({
        patternType: 'PRODUCT_INQUIRY',
        triggerEventType: 'PRODUCT_INQUIRY',
        context: { category: 'saree' },
        eligibleOutcomeCount: 0,
        confidence: 0,
      }),
      { patternType: 'PRICE_OBJECTION', category: 'saree' },
      now
    )
    expect(result.score).toBe(15)
    expect(result.score).toBeLessThan(MIN_MATCH_SCORE)
    expect(isEligibleMatch(result)).toBe(false)
  })

  it('caps evidence at 20', () => {
    const result = scoreSalesPattern(
      row({ eligibleOutcomeCount: 80, confidence: 0 }),
      { patternType: 'PRICE_OBJECTION' },
      now
    )
    expect(result.score).toBe(40 + 20)
  })
})

describe('situationFromTurn', () => {
  it('uses only structured shopping fields', () => {
    const shopping = {
      ...emptyShoppingContext(),
      categoryHint: 'Kurti',
      maxPrice: 3500,
      selectedIds: ['p-navy'],
    }
    const situation = situationFromTurn({
      salesTurn: classifySalesTurn('too expensive'),
      queryText: 'too expensive',
      shopping,
    })
    expect(situation).toEqual({
      patternType: 'PRICE_OBJECTION',
      category: 'kurti',
      priceBand: '3000-4999',
      budgetBand: '3000-4999',
      productId: 'p-navy',
    })
  })

  it('does not invent a category from a product title', () => {
    const situation = situationFromTurn({
      salesTurn: classifySalesTurn("I'll take this"),
      queryText: "I'll take this silk saree",
      shopping: emptyShoppingContext(),
    })
    expect(situation?.category).toBeUndefined()
    expect(situation?.priceBand).toBeUndefined()
  })
})
