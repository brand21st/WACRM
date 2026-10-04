import { describe, expect, it } from 'vitest'
import {
  CHECKOUT_BUTTON_LABEL,
  VIEW_CART_BUTTON_LABEL,
  PRODUCT_BUTTON_LABEL,
  cardHasCheckout,
  ctaBodyFromCard,
  firstCheckoutFromCards,
  parseProductCardButton,
  productCardCta,
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

describe('PRODUCT_BUTTON_LABEL', () => {
  it('is View product', () => {
    expect(PRODUCT_BUTTON_LABEL).toBe('View product')
    expect(PRODUCT_BUTTON_LABEL.length).toBeLessThanOrEqual(20)
  })
})

describe('parseProductCardButton', () => {
  it('defaults to checkout', () => {
    expect(parseProductCardButton(undefined)).toBe('checkout')
    expect(parseProductCardButton('checkout')).toBe('checkout')
    expect(parseProductCardButton('other')).toBe('checkout')
  })

  it('accepts product', () => {
    expect(parseProductCardButton('product')).toBe('product')
  })
})

describe('productCardCta', () => {
  const card = {
    inStock: true,
    checkoutUrl: 'https://shop.example/cart/99:1?checkout',
    productUrl: 'https://shop.example/products/red-bag',
  }

  it('uses checkout URL and Checkout NOW by default', () => {
    expect(productCardCta(card, 'checkout')).toEqual({
      url: card.checkoutUrl,
      displayText: CHECKOUT_BUTTON_LABEL,
    })
    expect(productCardCta(card, undefined)).toEqual({
      url: card.checkoutUrl,
      displayText: CHECKOUT_BUTTON_LABEL,
    })
  })

  it('skips checkout when the item is out of stock', () => {
    expect(productCardCta({ ...card, inStock: false }, 'checkout')).toBeNull()
  })

  it('uses the product URL and View product in product mode', () => {
    expect(productCardCta({ ...card, inStock: false }, 'product')).toEqual({
      url: card.productUrl,
      displayText: PRODUCT_BUTTON_LABEL,
    })
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
