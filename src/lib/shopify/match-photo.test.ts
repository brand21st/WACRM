import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  IMAGE_PLACEHOLDER,
  PRODUCT_PHOTO_PLACEHOLDER,
} from '@/lib/ai/describe-inbound-image'

const h = vi.hoisted(() => ({
  searchCatalogSnapshot: vi.fn(),
  listNewArrivals: vi.fn(),
  searchProductsLive: vi.fn(),
  hydrateListingImages: vi.fn(async (_config: unknown, hits: unknown) => hits),
}))

vi.mock('./catalog', () => ({
  searchCatalogSnapshot: h.searchCatalogSnapshot,
  listNewArrivals: h.listNewArrivals,
  searchProductsLive: h.searchProductsLive,
  hydrateListingImages: h.hydrateListingImages,
}))

import {
  isUnusablePhotoDescription,
  matchProductsFromPhoto,
  photoMatchQueries,
} from './match-photo'

function fixtureProduct(
  overrides: Partial<ShopifyProductHit> = {},
): ShopifyProductHit {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'red-leather-tote',
    title: 'Red Leather Tote',
    description: 'A red leather tote bag with gold zipper',
    imageUrl: 'https://cdn.example/tote.jpg',
    productUrl: 'https://shop.example/products/red-leather-tote',
    cartUrl: 'https://shop.example/cart/11:1',
    checkoutUrl: 'https://shop.example/cart/11:1?checkout',
    priceMin: '49.00',
    priceMax: '49.00',
    currency: 'USD',
    variants: [
      {
        id: 'gid://shopify/ProductVariant/11',
        variantId: '11',
        title: 'Default',
        sku: 'TOTE-RED',
        price: '49.00',
        compareAtPrice: null,
        available: true,
        options: [{ name: 'Color', value: 'Red' }],
      },
    ],
    ...overrides,
  }
}

const STORE: ShopifyStoreConfig = {
  accountId: 'a',
  shopDomain: 'acme.myshopify.com',
  accessToken: 't',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'USD',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

const db = {} as SupabaseClient

describe('photoMatchQueries', () => {
  it('uses token phrases instead of the full vision sentence', () => {
    const sentence = 'red leather tote bag with gold zipper and visible brand logo'
    const queries = photoMatchQueries(sentence)
    expect(queries).not.toContain(sentence)
    expect(queries[0]).toBe('red leather tote')
    expect(queries).toContain('red leather')
    expect(queries).toContain('red')
  })

  it('prefers structured searchQueries from shopping vision JSON', () => {
    const queries = photoMatchQueries(
      '{"type":"saree","color":"red","searchQueries":["pournami red saree","red saree"]}',
    )
    expect(queries[0]).toBe('pournami red saree')
    expect(queries).toContain('red saree')
  })
})

describe('isUnusablePhotoDescription', () => {
  it('skips empty and placeholder descriptions', () => {
    expect(isUnusablePhotoDescription('')).toBe(true)
    expect(isUnusablePhotoDescription('   ')).toBe(true)
    expect(isUnusablePhotoDescription(PRODUCT_PHOTO_PLACEHOLDER)).toBe(true)
    expect(isUnusablePhotoDescription(IMAGE_PLACEHOLDER)).toBe(true)
    expect(isUnusablePhotoDescription('red leather tote')).toBe(false)
  })
})

describe('matchProductsFromPhoto', () => {
  beforeEach(() => {
    h.searchCatalogSnapshot.mockReset()
    h.listNewArrivals.mockReset()
    h.searchProductsLive.mockReset()
    h.searchCatalogSnapshot.mockResolvedValue([])
    h.listNewArrivals.mockResolvedValue([])
    h.searchProductsLive.mockResolvedValue([])
  })

  it('ranks fixture catalog hits from a vision description', async () => {
    const tote = fixtureProduct()
    const sneakers = fixtureProduct({
      id: 'gid://shopify/Product/2',
      handle: 'blue-sneakers',
      title: 'Blue Sneakers',
      description: 'Canvas runners',
      variants: [
        {
          id: 'v2',
          variantId: '22',
          title: 'Default',
          sku: 'SNK-BLU',
          price: '80',
          compareAtPrice: null,
          available: true,
          options: [{ name: 'Color', value: 'Blue' }],
        },
      ],
    })
    h.searchCatalogSnapshot.mockResolvedValue([sneakers, tote])

    const hits = await matchProductsFromPhoto(
      db,
      STORE,
      'red leather tote bag with gold zipper',
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Red Leather Tote')
    expect(hits[0].sku).toBeUndefined()
    expect(h.searchCatalogSnapshot.mock.calls.map((c) => c[2])).not.toContain(
      'red leather tote bag with gold zipper',
    )
  })

  it('unions snapshot and live Shopify hits before ranking', async () => {
    const tote = fixtureProduct()
    const sneakers = fixtureProduct({
      id: 'gid://shopify/Product/2',
      handle: 'blue-sneakers',
      title: 'Blue Sneakers',
      description: 'Canvas runners',
      imageUrl: 'https://cdn.example/sneakers.jpg',
      productUrl: 'https://shop.example/products/blue-sneakers',
      variants: [],
    })
    h.searchCatalogSnapshot.mockResolvedValue([sneakers])
    h.searchProductsLive.mockResolvedValue([tote])

    const hits = await matchProductsFromPhoto(
      db,
      STORE,
      'red leather tote bag with gold zipper',
    )
    expect(h.searchCatalogSnapshot).toHaveBeenCalled()
    expect(h.searchProductsLive).toHaveBeenCalled()
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Red Leather Tote')
  })

  it('vision-confirms the catalog image when two similar products score', async () => {
    const tote = fixtureProduct()
    const backpack = fixtureProduct({
      id: 'gid://shopify/Product/3',
      handle: 'red-leather-backpack',
      title: 'Red Leather Backpack',
      description: 'A red leather backpack',
      imageUrl: 'https://cdn.example/backpack.jpg',
      productUrl: 'https://shop.example/products/red-leather-backpack',
    })
    h.searchCatalogSnapshot.mockResolvedValue([tote, backpack])

    const hits = await matchProductsFromPhoto(
      db,
      STORE,
      'red leather bag',
      {
        customerImageUrl: 'https://cdn.example/customer.jpg',
        apiKey: 'sk-test',
        confirmImpl: async () => [backpack],
      },
    )
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Red Leather Backpack')
  })

  it('keeps token rank when vision confirm fails', async () => {
    const tote = fixtureProduct()
    const backpack = fixtureProduct({
      id: 'gid://shopify/Product/3',
      handle: 'red-leather-backpack',
      title: 'Red Leather Backpack',
      description: 'A red leather backpack',
      imageUrl: 'https://cdn.example/backpack.jpg',
      productUrl: 'https://shop.example/products/red-leather-backpack',
    })
    h.searchCatalogSnapshot.mockResolvedValue([tote, backpack])

    const hits = await matchProductsFromPhoto(
      db,
      STORE,
      'red leather tote',
      {
        customerImageUrl: 'https://cdn.example/customer.jpg',
        apiKey: 'sk-test',
        confirmImpl: async () => {
          throw new Error('vision down')
        },
      },
    )
    expect(hits[0].title).toBe('Red Leather Tote')
  })

  it('returns an empty list when the catalog has no scoring matches', async () => {
    h.searchCatalogSnapshot.mockResolvedValue([])
    h.searchProductsLive.mockResolvedValue([])
    h.listNewArrivals.mockResolvedValue([
      fixtureProduct({
        id: 'gid://shopify/Product/9',
        handle: 'unrelated-mug',
        title: 'Ceramic Mug',
        description: 'White coffee mug',
        variants: [
          {
            id: 'v9',
            variantId: '99',
            title: 'Default',
            sku: 'MUG-WHT',
            price: '12',
            compareAtPrice: null,
            available: true,
            options: [],
          },
        ],
      }),
    ])

    const hits = await matchProductsFromPhoto(
      db,
      STORE,
      'red leather tote with gold zipper',
    )
    expect(hits).toEqual([])
  })

  it('vision-confirms a single catalog candidate', async () => {
    const tote = fixtureProduct()
    h.searchCatalogSnapshot.mockResolvedValue([tote])
    const confirmImpl = vi.fn(async () => [tote])

    const hits = await matchProductsFromPhoto(db, STORE, 'red leather tote', {
      customerImageUrl: 'https://cdn.example/customer.jpg',
      apiKey: 'sk-test',
      confirmImpl,
    })
    expect(confirmImpl).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: [tote],
      }),
    )
    expect(hits).toEqual([tote])
  })

  it('keeps a vision-confirmed hit even when title tokens do not overlap', async () => {
    const saree = fixtureProduct({
      id: 'gid://shopify/Product/8',
      handle: 'kerala-saree',
      title: 'കേരള സാരി',
      description: 'handloom',
      variants: [],
    })
    h.searchCatalogSnapshot.mockResolvedValue([saree])

    const hits = await matchProductsFromPhoto(db, STORE, 'red cotton dress', {
      customerImageUrl: 'https://cdn.example/customer.jpg',
      apiKey: 'sk-test',
      confirmImpl: async () => [saree],
    })
    expect(hits).toEqual([saree])
  })

  it('returns nothing when vision confirm says none match', async () => {
    const tote = fixtureProduct()
    const backpack = fixtureProduct({
      id: 'gid://shopify/Product/3',
      handle: 'red-leather-backpack',
      title: 'Red Leather Backpack',
      description: 'A red leather backpack',
      imageUrl: 'https://cdn.example/backpack.jpg',
      productUrl: 'https://shop.example/products/red-leather-backpack',
    })
    h.searchCatalogSnapshot.mockResolvedValue([tote, backpack])

    const hits = await matchProductsFromPhoto(db, STORE, 'red leather bag', {
      customerImageUrl: 'https://cdn.example/customer.jpg',
      apiKey: 'sk-test',
      confirmImpl: async () => [],
    })
    expect(hits).toEqual([])
  })

  it('does not invent products from an empty or placeholder description', async () => {
    expect(await matchProductsFromPhoto(db, STORE, '   ')).toEqual([])
    expect(
      await matchProductsFromPhoto(db, STORE, PRODUCT_PHOTO_PLACEHOLDER),
    ).toEqual([])
    expect(h.searchCatalogSnapshot).not.toHaveBeenCalled()
    expect(h.searchProductsLive).not.toHaveBeenCalled()
    expect(h.listNewArrivals).not.toHaveBeenCalled()
  })
})
