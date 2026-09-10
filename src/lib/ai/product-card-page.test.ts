import { describe, expect, it } from 'vitest'
import type { ShopifyProductCard } from '@/lib/shopify'

import {
  isShowMoreAsk,
  PRODUCT_CARD_PAGE_SIZE,
  splitProductCardPage,
} from './product-card-page'

function card(n: number): ShopifyProductCard {
  return {
    title: `Item ${n}`,
    imageUrl: `https://cdn.example/${n}.jpg`,
    productUrl: `https://shop.example/products/${n}`,
    cartUrl: null,
    checkoutUrl: `https://shop.example/cart/${n}:1?checkout`,
    inStock: true,
    caption: `Item ${n}`,
  }
}

describe('splitProductCardPage', () => {
  it('uses a page size of 10', () => {
    expect(PRODUCT_CARD_PAGE_SIZE).toBe(10)
  })

  it('splits 25 cards into 10 then 15', () => {
    const cards = Array.from({ length: 25 }, (_, i) => card(i + 1))
    const { page, remaining } = splitProductCardPage(cards)
    expect(page).toHaveLength(10)
    expect(remaining).toHaveLength(15)
    expect(page[0].title).toBe('Item 1')
    expect(page[9].title).toBe('Item 10')
    expect(remaining[0].title).toBe('Item 11')
  })

  it('returns no remaining when the list fits on one page', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(i + 1))
    const { page, remaining } = splitProductCardPage(cards)
    expect(page).toHaveLength(10)
    expect(remaining).toEqual([])
  })

  it('returns empty page and remaining for an empty list', () => {
    expect(splitProductCardPage([])).toEqual({ page: [], remaining: [] })
  })
})

describe('isShowMoreAsk', () => {
  it('matches the wacrm action id and typed show more', () => {
    expect(
      isShowMoreAsk('[Customer tapped "Show more" (action: wacrm:show_more)]'),
    ).toBe(true)
    expect(isShowMoreAsk('show more')).toBe(true)
    expect(isShowMoreAsk('see more')).toBe(true)
    expect(isShowMoreAsk('show more products')).toBe(true)
  })

  it('does not match unrelated browse text', () => {
    expect(isShowMoreAsk('show catalog')).toBe(false)
    expect(isShowMoreAsk('new products')).toBe(false)
    expect(isShowMoreAsk('')).toBe(false)
  })
})
