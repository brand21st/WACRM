import { describe, expect, it } from 'vitest'
import {
  DISCOUNT_PROMPT,
  discountSkipReplyId,
  isDiscountSkipText,
  isPlausibleDiscountCode,
  parseDiscountSkipReply,
  sanitizeDiscountCode,
} from './discount-code'

describe('discount skip reply ids', () => {
  it('round-trips the order reference', () => {
    expect(parseDiscountSkipReply(discountSkipReplyId('wac_abc123'))).toEqual({
      referenceId: 'wac_abc123',
    })
  })

  it('ignores address confirmation taps', () => {
    expect(parseDiscountSkipReply('wac_addr_ok:wac_abc123')).toBeNull()
    expect(parseDiscountSkipReply('skip')).toBeNull()
  })
})

describe('typed discount codes', () => {
  it('accepts Shopify-like codes and skip words', () => {
    expect(isPlausibleDiscountCode('SAVE10')).toBe(true)
    expect(isPlausibleDiscountCode('  summer-sale ')).toBe(true)
    expect(isPlausibleDiscountCode('Hi')).toBe(false)
    expect(isPlausibleDiscountCode('please apply a discount')).toBe(false)
    expect(sanitizeDiscountCode('  SAVE10 ')).toBe('SAVE10')
    expect(isDiscountSkipText('Skip')).toBe(true)
    expect(isDiscountSkipText('SAVE10')).toBe(false)
    expect(DISCOUNT_PROMPT.length).toBeGreaterThan(10)
  })
})
