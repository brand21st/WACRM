import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildCartOffer,
  cartOfferFallbackText,
  itemsFromInteractiveRows,
  itemsFromProductCards,
  loadLastShownCartItems,
  resolveCartOfferItems,
} from './cart-offer'
import type { ShopifyProductCard } from './types'

function card(
  overrides: Partial<ShopifyProductCard> = {},
): ShopifyProductCard {
  return {
    title: 'Red Bag',
    imageUrl: 'https://cdn.example/bag.jpg',
    productUrl: 'https://shop.example/products/red-bag',
    cartUrl: 'https://shop.example/cart/99:1',
    checkoutUrl: 'https://shop.example/cart/99:1?checkout',
    inStock: true,
    caption: 'Red Bag\n49 USD\nStock in\nView: https://shop.example/products/red-bag',
    ...overrides,
  }
}

describe('itemsFromProductCards', () => {
  it('keeps in-stock cards with cart permalinks and skips the rest', () => {
    expect(
      itemsFromProductCards([
        card(),
        card({
          title: 'Hat',
          cartUrl: 'https://shop.example/cart/88:2',
          checkoutUrl: 'https://shop.example/cart/88:2?checkout',
          caption: 'Hat\n12 USD\nStock in',
        }),
        card({ inStock: false, title: 'Sold out' }),
        card({ cartUrl: null, checkoutUrl: null, title: 'No link' }),
        card({ title: 'Dup', cartUrl: 'https://shop.example/cart/99:1' }),
      ]),
    ).toEqual([
      {
        variantId: '99',
        quantity: 1,
        title: 'Red Bag',
        price: '49 USD',
        imageUrl: 'https://cdn.example/bag.jpg',
      },
      {
        variantId: '88',
        quantity: 2,
        title: 'Hat',
        price: '12 USD',
        imageUrl: 'https://cdn.example/bag.jpg',
      },
    ])
  })
})

describe('itemsFromInteractiveRows', () => {
  it('parses recent checkout CTAs newest-first and caps at 3', () => {
    const items = itemsFromInteractiveRows([
      {
        interactive_payload: {
          kind: 'cta_url',
          body: 'Red Bag\n49 USD',
          display_text: 'Checkout NOW',
          url: 'https://shop.example/cart/99:1?checkout',
          header_image: 'https://cdn.example/bag.jpg',
        },
      },
      {
        interactive_payload: {
          kind: 'buttons',
          body: 'Hi',
          buttons: [{ id: 'x', title: 'X' }],
        },
      },
      {
        interactive_payload: {
          kind: 'cta_url',
          body: 'Hat and scarf',
          display_text: 'View cart',
          url: 'https://shop.example/cart/88:1,77:1',
        },
      },
    ])
    expect(items).toEqual([
      {
        variantId: '99',
        quantity: 1,
        title: 'Red Bag',
        imageUrl: 'https://cdn.example/bag.jpg',
      },
      {
        variantId: '88',
        quantity: 1,
        title: 'Hat and scarf',
        imageUrl: null,
      },
      {
        variantId: '77',
        quantity: 1,
        title: 'Hat and scarf',
        imageUrl: null,
      },
    ])
  })
})

describe('buildCartOffer', () => {
  it('builds multi-item cart and checkout URLs', () => {
    const offer = buildCartOffer('https://shop.example', [
      { variantId: '99', quantity: 1, title: 'Red Bag', price: '49 USD' },
      { variantId: '88', quantity: 2, title: 'Hat' },
    ])
    expect(offer).toMatchObject({
      cartUrl: 'https://shop.example/cart/99:1,88:2',
      checkoutUrl: 'https://shop.example/cart/99:1,88:2?checkout',
      summaryLines: ['Red Bag — 49 USD', 'Hat ×2'],
    })
  })

  it('returns null when empty or domain is missing', () => {
    expect(buildCartOffer('https://shop.example', [])).toBeNull()
    expect(
      buildCartOffer('', [{ variantId: '99', quantity: 1, title: 'Bag' }]),
    ).toBeNull()
  })
})

describe('cartOfferFallbackText', () => {
  it('lists items', () => {
    expect(
      cartOfferFallbackText([
        { variantId: '99', quantity: 1, title: 'Red Bag', price: '49 USD' },
      ]),
    ).toBe('Here is your cart:\n• Red Bag — 49 USD')
  })
})

describe('loadLastShownCartItems', () => {
  it('reads recent bot CTA rows', async () => {
    const rows = [
      {
        interactive_payload: {
          kind: 'cta_url',
          body: 'Red Bag',
          display_text: 'Checkout NOW',
          url: 'https://shop.example/cart/99:1?checkout',
        },
        content_text: 'Red Bag',
      },
    ]
    const db = {
      from: () => {
        const chain = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => Promise.resolve({ data: rows, error: null }),
        }
        return chain
      },
    } as unknown as SupabaseClient
    const items = await loadLastShownCartItems(db, 'conv-1')
    expect(items[0]?.variantId).toBe('99')
  })
})

describe('resolveCartOfferItems', () => {
  it('prefers this-turn cards over stored CTAs', async () => {
    const items = await resolveCartOfferItems({
      db: {} as SupabaseClient,
      conversationId: 'conv-1',
      cards: [card()],
    })
    expect(items).toHaveLength(1)
    expect(items[0]?.variantId).toBe('99')
  })
})
