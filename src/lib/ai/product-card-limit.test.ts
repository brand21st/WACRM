import { describe, it, expect } from 'vitest'
import {
  inferProductCardLimit,
  isShopifyProductAsk,
  resolveProductCardLimit,
} from './product-card-limit'

describe('inferProductCardLimit', () => {
  it('uses an explicit number in the ask', () => {
    expect(inferProductCardLimit('show 2')).toBe(2)
    expect(inferProductCardLimit('5 products')).toBe(5)
    expect(inferProductCardLimit('send me 10 items')).toBe(10)
    expect(inferProductCardLimit('show 20 products')).toBe(20)
  })

  it('sends one card for a singular product ask', () => {
    expect(inferProductCardLimit('send me the red bag')).toBe(1)
    expect(inferProductCardLimit('that one')).toBe(1)
    expect(inferProductCardLimit('this product')).toBe(1)
    expect(inferProductCardLimit('SKU AB-1234')).toBe(1)
  })

  it('sends a few cards for options', () => {
    expect(inferProductCardLimit('show some options')).toBe(3)
    expect(inferProductCardLimit('a few sarees')).toBe(3)
  })

  it('sends every match for browse-all phrases', () => {
    expect(inferProductCardLimit('new products')).toBe(50)
    expect(inferProductCardLimit('new arrivals')).toBe(50)
    expect(inferProductCardLimit('best selling')).toBe(50)
    expect(inferProductCardLimit('trending')).toBe(50)
    expect(inferProductCardLimit('wacrm:products')).toBe(50)
  })

  it('sends every catalog match for a named search with no count', () => {
    expect(inferProductCardLimit('red bags')).toBe(50)
    expect(inferProductCardLimit('saree')).toBe(50)
    expect(inferProductCardLimit('show me red bags')).toBe(50)
  })

  it('sends every catalog match for related / recommend asks', () => {
    expect(inferProductCardLimit('recommend something for me')).toBe(50)
    expect(inferProductCardLimit('what should I buy')).toBe(50)
    expect(inferProductCardLimit('suggest products')).toBe(50)
    expect(inferProductCardLimit('related products')).toBe(50)
    expect(inferProductCardLimit('similar bags')).toBe(50)
    expect(inferProductCardLimit('matching coord set')).toBe(50)
  })

  it('defaults to every catalog match when the text is empty', () => {
    expect(inferProductCardLimit('')).toBe(50)
  })
})

describe('isShopifyProductAsk', () => {
  it('matches named, related, and browse product asks', () => {
    expect(isShopifyProductAsk('green color dress')).toBe(true)
    expect(isShopifyProductAsk('rani pink product')).toBe(true)
    expect(isShopifyProductAsk('related products')).toBe(true)
    expect(isShopifyProductAsk('new arrivals')).toBe(true)
    expect(isShopifyProductAsk('send me the red bag')).toBe(true)
  })

  it('does not treat non-catalog asks as product searches', () => {
    expect(isShopifyProductAsk('excel')).toBe(false)
    expect(isShopifyProductAsk('hello')).toBe(false)
    expect(isShopifyProductAsk('')).toBe(false)
  })
})

describe('resolveProductCardLimit', () => {
  it('lets an explicit tool limit win', () => {
    expect(resolveProductCardLimit(7, 'send me the red bag')).toBe(7)
    expect(resolveProductCardLimit('2', 'new arrivals')).toBe(2)
  })

  it('clamps a tool limit to 1–50', () => {
    expect(resolveProductCardLimit(0, 'bags')).toBe(1)
    expect(resolveProductCardLimit(99, 'bags')).toBe(50)
  })

  it('infers from customer text when the tool omits limit', () => {
    expect(resolveProductCardLimit(undefined, 'send the red bag')).toBe(1)
    expect(resolveProductCardLimit(null, 'new arrivals')).toBe(50)
    expect(resolveProductCardLimit(undefined, 'show me red bags')).toBe(50)
  })
})
