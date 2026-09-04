import { describe, it, expect } from 'vitest'
import {
  inferProductCardLimit,
  resolveProductCardLimit,
} from './product-card-limit'

describe('inferProductCardLimit', () => {
  it('uses an explicit number in the ask', () => {
    expect(inferProductCardLimit('show 2')).toBe(2)
    expect(inferProductCardLimit('5 products')).toBe(5)
    expect(inferProductCardLimit('send me 10 items')).toBe(10)
    expect(inferProductCardLimit('show 20 products')).toBe(10)
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

  it('sends ten cards for browse-all phrases', () => {
    expect(inferProductCardLimit('new products')).toBe(10)
    expect(inferProductCardLimit('new arrivals')).toBe(10)
    expect(inferProductCardLimit('best selling')).toBe(10)
    expect(inferProductCardLimit('trending')).toBe(10)
    expect(inferProductCardLimit('wacrm:products')).toBe(10)
  })

  it('sends three cards for a named search with no count', () => {
    expect(inferProductCardLimit('red bags')).toBe(3)
    expect(inferProductCardLimit('saree')).toBe(3)
    expect(inferProductCardLimit('show me red bags')).toBe(3)
  })

  it('sends three cards for recommend / for me with no count', () => {
    expect(inferProductCardLimit('recommend something for me')).toBe(3)
    expect(inferProductCardLimit('what should I buy')).toBe(3)
    expect(inferProductCardLimit('suggest products')).toBe(3)
  })

  it('defaults to three when the text is empty', () => {
    expect(inferProductCardLimit('')).toBe(3)
  })
})

describe('resolveProductCardLimit', () => {
  it('lets an explicit tool limit win', () => {
    expect(resolveProductCardLimit(7, 'send me the red bag')).toBe(7)
    expect(resolveProductCardLimit('2', 'new arrivals')).toBe(2)
  })

  it('clamps a tool limit to 1–10', () => {
    expect(resolveProductCardLimit(0, 'bags')).toBe(1)
    expect(resolveProductCardLimit(99, 'bags')).toBe(10)
  })

  it('infers from customer text when the tool omits limit', () => {
    expect(resolveProductCardLimit(undefined, 'send the red bag')).toBe(1)
    expect(resolveProductCardLimit(null, 'new arrivals')).toBe(10)
    expect(resolveProductCardLimit(undefined, 'show me red bags')).toBe(3)
  })
})
