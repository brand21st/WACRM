import { describe, expect, it } from 'vitest'
import { deriveSalesStage, isComplementaryAsk } from './sales-stage'

describe('deriveSalesStage', () => {
  it('starts at discovery with no signals', () => {
    expect(deriveSalesStage({})).toBe('discovery')
  })

  it('uses consideration when cards were shown', () => {
    expect(deriveSalesStage({ shownIds: ['p-red'] })).toBe('consideration')
  })

  it('uses product_selected for a seed and never implies checkout focus', () => {
    expect(deriveSalesStage({ seedId: 'p-red' })).toBe('product_selected')
    expect(deriveSalesStage({ selectedIds: ['p-red'] })).toBe('product_selected')
  })

  it('prefers cart, checkout, purchased, then post-purchase', () => {
    expect(deriveSalesStage({ hasCart: true, seedId: 'p-red' })).toBe('cart')
    expect(deriveSalesStage({ hasPendingCheckout: true, hasCart: true })).toBe(
      'checkout',
    )
    expect(deriveSalesStage({ hasPaidOrder: true })).toBe('purchased')
    expect(
      deriveSalesStage({ hasPaidOrder: true, complementaryAsk: true }),
    ).toBe('post_purchase')
  })
})

describe('isComplementaryAsk', () => {
  it('treats cross-sell, bundle, and upsell as complementary', () => {
    expect(isComplementaryAsk('cross_sell')).toBe(true)
    expect(isComplementaryAsk('bundle')).toBe(true)
    expect(isComplementaryAsk('upsell')).toBe(true)
    expect(isComplementaryAsk('similar')).toBe(false)
  })
})
