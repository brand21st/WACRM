import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_BUTTON_LABEL,
  VIEW_CART_BUTTON_LABEL,
  cardHasCheckout,
  ctaBodyFromCard,
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

  it('strips View cart labels with a cart URL', () => {
    expect(
      stripCheckoutFromReply(
        'View cart: https://shop.example/cart/99:1',
        'https://shop.example/cart/99:1',
      ),
    ).toBe('')
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
  it('is Checkout NOW', () => {
    expect(CHECKOUT_BUTTON_LABEL).toBe('Checkout NOW')
    expect(CHECKOUT_BUTTON_LABEL.length).toBeLessThanOrEqual(20)
  })
})

describe('VIEW_CART_BUTTON_LABEL', () => {
  it('is View cart', () => {
    expect(VIEW_CART_BUTTON_LABEL).toBe('View cart')
    expect(VIEW_CART_BUTTON_LABEL.length).toBeLessThanOrEqual(20)
  })
})

describe('cardHasCheckout', () => {
  it('is true only when the item is in stock with a checkout URL', () => {
    expect(
      cardHasCheckout({
        inStock: true,
        checkoutUrl: 'https://shop.example/cart/1:1?checkout',
      }),
    ).toBe(true)
    expect(cardHasCheckout({ inStock: false, checkoutUrl: 'https://x' })).toBe(
      false,
    )
    expect(cardHasCheckout({ inStock: true, checkoutUrl: '' })).toBe(false)
  })
})

describe('ctaBodyFromCard', () => {
  it('is the product card above the Checkout button, including View', () => {
    expect(
      ctaBodyFromCard({
        title: 'Red Leather Tote',
        caption:
          'Red Leather Tote\n49.00–69.00 USD\nStock in\nVariants: M, XL, XXL\nColor: Red, Blue\nView: https://shop.example/products/red-leather-tote',
      }),
    ).toBe(
      'Red Leather Tote\n49.00–69.00 USD\nStock in\nVariants: M, XL, XXL\nColor: Red, Blue\nView: https://shop.example/products/red-leather-tote',
    )
  })

  it('falls back to the title when the caption is empty', () => {
    expect(ctaBodyFromCard({ title: 'Red Bag', caption: '' })).toBe('Red Bag')
  })
})
