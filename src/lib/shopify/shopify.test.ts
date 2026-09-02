import { afterEach, describe, it, expect, vi } from 'vitest'
import { normalizeShopDomain } from './domain'
import { productPageUrl, cartPermalink, checkoutPermalink, storePageUrl } from './permalinks'
import { shopifyPhoneMatchesContact, customerSearchQueries } from './phone'
import { shoppingOrSupportPrompt } from '@/lib/ai/describe-inbound-image'
import { mapGqlProduct } from './map-product'
import { rankProductsByDescription } from './rank'
import { shopifyGraphql } from './client'
import { executeShopifyTool, toCard } from './tools'
import * as matchPhoto from './match-photo'
import { searchProductsLive, listNewArrivals, searchCatalogSnapshot } from './catalog'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as client from './client'
import * as storeContent from './store-content'

describe('normalizeShopDomain', () => {
  it('accepts subdomain, host, and URL', () => {
    expect(normalizeShopDomain('Acme-Store')).toBe('acme-store.myshopify.com')
    expect(normalizeShopDomain('acme-store.myshopify.com')).toBe(
      'acme-store.myshopify.com',
    )
    expect(normalizeShopDomain('https://acme-store.myshopify.com/admin')).toBe(
      'acme-store.myshopify.com',
    )
  })

  it('rejects junk', () => {
    expect(normalizeShopDomain('')).toBeNull()
    expect(normalizeShopDomain('not a shop')).toBeNull()
  })
})

describe('permalinks', () => {
  it('builds product, cart, and checkout URLs', () => {
    expect(productPageUrl('https://shop.example', 'red-bag')).toBe(
      'https://shop.example/products/red-bag',
    )
    expect(storePageUrl('https://shop.example', 'about')).toBe(
      'https://shop.example/pages/about',
    )
    expect(cartPermalink('https://shop.example', '12345')).toBe(
      'https://shop.example/cart/12345:1',
    )
    expect(checkoutPermalink('https://shop.example', '12345')).toBe(
      'https://shop.example/cart/12345:1?checkout',
    )
  })
})

describe('shopify phone matching', () => {
  it('matches E.164 against digit-only WhatsApp numbers', () => {
    expect(shopifyPhoneMatchesContact('918848772371', ['+91 88487 72371'])).toBe(
      true,
    )
    expect(shopifyPhoneMatchesContact('918848772371', ['+15551212'])).toBe(false)
  })

  it('builds customer search queries', () => {
    expect(customerSearchQueries('918848772371')).toContain('phone:918848772371')
    expect(customerSearchQueries('918848772371')).toContain('phone:+918848772371')
  })
})

describe('mapGqlProduct', () => {
  it('maps variants and permalinks', () => {
    const hit = mapGqlProduct(
      {
        id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        description: 'Leather tote',
        featuredImage: { url: 'https://cdn.example/bag.jpg' },
        variants: {
          nodes: [
            {
              id: 'gid://shopify/ProductVariant/9',
              legacyResourceId: '99',
              title: 'Default',
              sku: 'BAG-RED',
              availableForSale: true,
              price: '49.00',
              selectedOptions: [{ name: 'Color', value: 'Red' }],
            },
          ],
        },
      },
      'https://shop.example',
      'USD',
    )
    expect(hit?.productUrl).toBe('https://shop.example/products/red-bag')
    expect(hit?.checkoutUrl).toBe('https://shop.example/cart/99:1?checkout')
    expect(hit?.variants[0]?.sku).toBe('BAG-RED')
  })
})

describe('toCard', () => {
  it('includes Stock in, variants, and View on an in-stock product', () => {
    const card = toCard(fixtureProduct())
    expect(card.inStock).toBe(true)
    expect(card.caption).toContain('Stock in')
    expect(card.caption).toContain('Variants:')
    expect(card.caption).toContain('Red — in stock')
    expect(card.caption).toContain(
      'View: https://shop.example/products/red-leather-tote',
    )
    expect(card.caption).not.toMatch(/Buy now/)
    expect(card.caption).not.toContain(card.checkoutUrl)
    expect(card.checkoutUrl).toBe('https://shop.example/cart/11:1?checkout')
  })

  it('includes Stock out and no Buy now URL when every variant is unavailable', () => {
    const card = toCard(
      fixtureProduct({
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Default',
            sku: 'TOTE-RED',
            price: '49.00',
            compareAtPrice: null,
            available: false,
            options: [{ name: 'Color', value: 'Red' }],
          },
        ],
      }),
    )
    expect(card.inStock).toBe(false)
    expect(card.caption).toContain('Stock out')
    expect(card.caption).toContain('Red — out of stock')
    expect(card.caption).toContain(
      'View: https://shop.example/products/red-leather-tote',
    )
    expect(card.caption).not.toMatch(/Buy now/)
    expect(card.caption).not.toContain('https://shop.example/cart/11:1?checkout')
  })

  it('lists multiple variants with prices when they differ, and skips Default Title', () => {
    const card = toCard(
      fixtureProduct({
        priceMin: '49.00',
        priceMax: '69.00',
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Small',
            sku: 'TOTE-S',
            price: '49.00',
            compareAtPrice: null,
            available: true,
            options: [
              { name: 'Color', value: 'Red' },
              { name: 'Size', value: 'S' },
            ],
          },
          {
            id: 'gid://shopify/ProductVariant/12',
            variantId: '12',
            title: 'Large',
            sku: 'TOTE-L',
            price: '69.00',
            compareAtPrice: null,
            available: false,
            options: [
              { name: 'Color', value: 'Blue' },
              { name: 'Size', value: 'L' },
            ],
          },
          {
            id: 'gid://shopify/ProductVariant/13',
            variantId: '13',
            title: 'Default Title',
            sku: 'TOTE-DEF',
            price: '49.00',
            compareAtPrice: null,
            available: true,
            options: [{ name: 'Title', value: 'Default Title' }],
          },
        ],
      }),
    )
    expect(card.caption).toContain('Red / S · 49.00 — in stock')
    expect(card.caption).toContain('Blue / L · 69.00 — out of stock')
    expect(card.caption).not.toContain('Default Title')
  })
})

describe('shopping vision prompt', () => {
  it('asks for searchable product attributes', () => {
    const prompt = shoppingOrSupportPrompt('shopping', '')
    expect(prompt).toMatch(/item type/i)
    expect(prompt).toMatch(/SKU/i)
  })
})

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

describe('rankProductsByDescription', () => {
  it('ranks a fixture product from a vision description', () => {
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
    const ranked = rankProductsByDescription(
      'red leather tote bag with gold zipper',
      [sneakers, tote],
    )
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.handle).toBe('red-leather-tote')
  })
})

describe('shopifyGraphql', () => {
  it('posts to Admin GraphQL 2026-07 with the access token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { shop: { name: 'Acme' } } }),
    })
    const data = await shopifyGraphql({
      shopDomain: 'acme.myshopify.com',
      accessToken: 'shpat_test',
      query: '{ shop { name } }',
      fetchImpl,
    })
    expect(data).toEqual({ shop: { name: 'Acme' } })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://acme.myshopify.com/admin/api/2026-07/graphql.json',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Shopify-Access-Token': 'shpat_test',
        }),
      }),
    )
  })
})

describe('searchCatalogSnapshot', () => {
  it('retries without body when migration 047 is not applied', async () => {
    const rows = [
      {
        shopify_product_id: 'gid://shopify/Product/1',
        handle: 'red-bag',
        title: 'Red Bag',
        body_excerpt: 'Leather tote',
        price_min: 49,
        price_max: 49,
        currency: 'USD',
        variant_summary: [],
        image_url: 'https://cdn.example/bag.jpg',
        product_url: 'https://shop.example/products/red-bag',
        published_at: '2026-01-01T00:00:00Z',
      },
    ]
    const select = vi.fn((cols: string) => {
      const chain: Record<string, unknown> = {}
      const result =
        cols.includes('body,')
          ? {
              data: null,
              error: {
                code: '42703',
                message: 'column shopify_catalog_products.body does not exist',
              },
            }
          : { data: rows, error: null }
      chain.eq = () => chain
      chain.ilike = () => chain
      chain.order = () => chain
      chain.limit = () => Promise.resolve(result)
      return chain
    })
    const db = {
      from: () => ({ select }),
    } as unknown as SupabaseClient

    const hits = await searchCatalogSnapshot(db, 'acct-1', 'red bag', 5)
    expect(hits).toHaveLength(1)
    expect(hits[0].title).toBe('Red Bag')
    expect(select).toHaveBeenCalledWith(expect.stringContaining('body,'))
    expect(select).toHaveBeenCalledWith(expect.not.stringContaining('body,'))
  })
})

describe('live catalog queries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('maps product search results from Admin GraphQL', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            handle: 'red-bag',
            title: 'Red Bag',
            description: 'Leather tote',
            featuredImage: { url: 'https://cdn.example/bag.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/9',
                  legacyResourceId: '99',
                  title: 'Default',
                  sku: 'BAG-RED',
                  availableForSale: true,
                  price: '49.00',
                  selectedOptions: [{ name: 'Color', value: 'Red' }],
                },
              ],
            },
          },
        ],
      },
    })
    const hits = await searchProductsLive(STORE, 'red bag')
    expect(hits[0]?.title).toBe('Red Bag')
    expect(hits[0]?.checkoutUrl).toBe('https://shop.example/cart/99:1?checkout')
  })

  it('lists new arrivals sorted by created_at', async () => {
    const gql = vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: { nodes: [] },
    })
    await listNewArrivals({} as SupabaseClient, STORE, 5)
    expect(gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          sortKey: 'CREATED_AT',
          reverse: true,
        }),
      }),
    )
  })
})

describe('executeShopifyTool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not look up orders without a contact phone', async () => {
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: null },
      'lookup_my_orders',
      {},
    )
    expect(JSON.parse(result.json).note).toMatch(/phone/i)
    expect(JSON.parse(result.json).orders).toEqual([])
  })

  it('returns no orders when the Shopify customer phone does not match', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      customers: {
        nodes: [
          {
            phone: '+15550001111',
            defaultAddress: { phone: null },
            orders: {
              nodes: [
                {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  lineItems: { nodes: [] },
                  fulfillments: [],
                },
              ],
            },
          },
        ],
      },
    })
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: '918848772371' },
      'lookup_my_orders',
      { order_name: '#1001' },
    )
    const body = JSON.parse(result.json)
    expect(body.orders).toEqual([])
    expect(body.note).toMatch(/this WhatsApp number/i)
  })

  it('returns tracking only when the contact phone matches', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      customers: {
        nodes: [
          {
            phone: '+91 88487 72371',
            defaultAddress: { phone: null },
            orders: {
              nodes: [
                {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  displayFulfillmentStatus: 'FULFILLED',
                  lineItems: { nodes: [] },
                  fulfillments: [
                    {
                      status: 'SUCCESS',
                      trackingInfo: [
                        {
                          number: '1Z999',
                          url: 'https://track.example/1Z999',
                          company: 'UPS',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        ],
      },
    })
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: '918848772371' },
      'get_order_tracking',
      { order_name: '#1001' },
    )
    const body = JSON.parse(result.json)
    expect(body.orders).toHaveLength(1)
    expect(body.orders[0].tracking[0]).toMatchObject({
      number: '1Z999',
      company: 'UPS',
    })
    expect(body.orders[0].lineItems).toBeUndefined()
  })

  it('delegates match_product_from_photo to matchProductsFromPhoto', async () => {
    const tote = {
      id: 'gid://shopify/Product/1',
      handle: 'red-leather-tote',
      title: 'Red Leather Tote',
      description: 'Tote',
      imageUrl: 'https://cdn.example/tote.jpg',
      productUrl: 'https://shop.example/products/red-leather-tote',
      cartUrl: 'https://shop.example/cart/11:1',
      checkoutUrl: 'https://shop.example/cart/11:1?checkout',
      priceMin: '49.00',
      priceMax: '49.00',
      currency: 'USD',
      variants: [],
    }
    const spy = vi
      .spyOn(matchPhoto, 'matchProductsFromPhoto')
      .mockResolvedValue([tote])
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: null },
      'match_product_from_photo',
      { description: 'red leather tote' },
    )
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      STORE,
      'red leather tote',
    )
    const body = JSON.parse(result.json)
    expect(body.products[0].title).toBe('Red Leather Tote')
    expect(result.cards[0].imageUrl).toBe('https://cdn.example/tote.jpg')
  })

  it('searches synced store pages and policies', async () => {
    vi.spyOn(storeContent, 'searchStoreContent').mockResolvedValue([
      {
        kind: 'policy',
        title: 'Refund Policy',
        handle: 'refund-policy',
        body: 'Returns accepted within 30 days.',
        pageUrl: 'https://shop.example/policies/refund-policy',
      },
    ])
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: null },
      'search_store_info',
      { query: 'return policy' },
    )
    const body = JSON.parse(result.json)
    expect(body.pages[0].title).toBe('Refund Policy')
    expect(body.pages[0].body).toMatch(/30 days/)
  })
})

describe('oauth client credentials', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exchanges shpss secret for an access token', async () => {
    const { exchangeClientCredentials } = await import('./oauth')
    const fetchImpl = vi.fn(async () =>
      Response.json({ access_token: 'shpat_exchanged', expires_in: 86399 }),
    )
    const result = await exchangeClientCredentials({
      shopDomain: 'acme.myshopify.com',
      clientId: '914e6a78819a67dde293e4d5893867d6',
      clientSecret: 'shpss_test_secret',
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.accessToken).toBe('shpat_exchanged')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://acme.myshopify.com/admin/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
