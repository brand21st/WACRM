import { describe, it, expect } from 'vitest'
import { pickConfirmedHits } from './confirm-photo'
import type { ShopifyProductHit } from './types'

function hit(
  overrides: Partial<ShopifyProductHit> & Pick<ShopifyProductHit, 'id' | 'handle' | 'title'>,
): ShopifyProductHit {
  return {
    description: '',
    imageUrl: 'https://cdn.example/p.jpg',
    productUrl: `https://shop.example/products/${overrides.handle}`,
    cartUrl: null,
    checkoutUrl: null,
    priceMin: '10',
    priceMax: '10',
    currency: 'USD',
    variants: [],
    ...overrides,
  }
}

const tote = hit({
  id: 'gid://shopify/Product/1',
  handle: 'red-tote',
  title: 'Red Tote',
})
const mug = hit({
  id: 'gid://shopify/Product/2',
  handle: 'mug',
  title: 'Mug',
})

describe('pickConfirmedHits', () => {
  it('keeps only ids that were in the candidate list', () => {
    const picked = pickConfirmedHits(
      'Here: {"ids":["gid://shopify/Product/1","gid://shopify/Product/99"]}',
      [tote, mug],
    )
    expect(picked).toEqual([tote])
  })

  it('accepts handles and 0-based indexes', () => {
    expect(pickConfirmedHits('{"ids":["mug"]}', [tote, mug])).toEqual([mug])
    expect(pickConfirmedHits('{"indexes":[1]}', [tote, mug])).toEqual([mug])
  })

  it('returns empty when none of the ids match', () => {
    expect(pickConfirmedHits('{"ids":[]}', [tote, mug])).toEqual([])
    expect(pickConfirmedHits('not json', [tote, mug])).toEqual([])
  })
})
