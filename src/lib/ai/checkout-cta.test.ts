import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_BUTTON_LABEL,
  firstCheckoutFromCards,
  stripCheckoutFromReply,
  stripCheckoutUrlsFromReply,
} from './checkout-cta'

describe('firstCheckoutFromCards', () => {
  it('returns the first trusted checkout URL', () => {
    expect(
      firstCheckoutFromCards([
        { title: 'A', checkoutUrl: null },
        {
          title: 'Red Bag',
          checkoutUrl: 'https://shop.example/cart/99:1?checkout',
        },
      ]),
    ).toEqual({
      url: 'https://shop.example/cart/99:1?checkout',
      title: 'Red Bag',
    })
  })

  it('returns null when no card has a checkout URL', () => {
    expect(firstCheckoutFromCards([{ title: 'A', checkoutUrl: '' }])).toBeNull()
    expect(firstCheckoutFromCards([])).toBeNull()
  })
})

describe('stripCheckoutFromReply', () => {
  it('removes the checkout URL and leftover Buy now: label', () => {
    expect(
      stripCheckoutFromReply(
        'This looks like our Red Bag. Buy now: https://shop.example/cart/99:1?checkout',
        'https://shop.example/cart/99:1?checkout',
      ),
    ).toBe('This looks like our Red Bag.')
  })

  it('leaves unrelated text alone', () => {
    expect(stripCheckoutFromReply('Ithu und.', 'https://shop.example/x')).toBe(
      'Ithu und.',
    )
  })
})

describe('stripCheckoutUrlsFromReply', () => {
  it('strips every trusted checkout URL', () => {
    expect(
      stripCheckoutUrlsFromReply(
        'A https://shop.example/cart/99:1?checkout and B https://shop.example/cart/88:1?checkout',
        [
          'https://shop.example/cart/99:1?checkout',
          'https://shop.example/cart/88:1?checkout',
        ],
      ),
    ).toBe('A and B')
  })
})

describe('CHECKOUT_BUTTON_LABEL', () => {
  it('is Checkout', () => {
    expect(CHECKOUT_BUTTON_LABEL).toBe('Checkout')
  })
})
