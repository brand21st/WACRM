import { describe, it, expect } from 'vitest'
import { listingImagesForConfirm, pickConfirmedHits } from './confirm-photo'
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

describe('listingImagesForConfirm', () => {
  it('labels extra listing angles with the same product id', () => {
    const extra = hit({
      id: 'gid://shopify/Product/1',
      handle: 'red-tote',
      title: 'Red Tote',
      imageUrl: 'https://cdn.example/front.jpg',
      imageUrls: [
        'https://cdn.example/front.jpg',
        'https://cdn.example/side.jpg',
        'https://cdn.example/back.jpg',
      ],
    })
    const rows = listingImagesForConfirm([extra, mug])
    expect(rows[0]).toEqual({
      product: extra,
      url: 'https://cdn.example/front.jpg',
    })
    expect(rows.filter((r) => r.product.id === extra.id).map((r) => r.url)).toEqual(
      [
        'https://cdn.example/front.jpg',
        'https://cdn.example/side.jpg',
        'https://cdn.example/back.jpg',
      ],
    )
    expect(rows.some((r) => r.product.id === mug.id && r.url === mug.imageUrl)).toBe(
      true,
    )
  })
})
