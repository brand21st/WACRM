import { afterEach, describe, it, expect, vi } from 'vitest'
import { normalizeShopDomain } from './domain'
import {
  productPageUrl,
  cartPermalink,
  checkoutPermalink,
  cartPermalinkMulti,
  checkoutPermalinkMulti,
  parseCartPermalink,
  storePageUrl,
} from './permalinks'
import { shopifyPhoneMatchesContact, customerSearchQueries, toShopifyPhone } from './phone'
import { shoppingOrSupportPrompt } from '@/lib/ai/describe-inbound-image'
import { mapGqlProduct } from './map-product'
import {
  matchProductsToAsk,
  parseBudget,
  productSearchQuery,
  rankProductsByDescription,
  rankShoppingProducts,
  tokensFromDescription,
} from './rank'
import { shopifyGraphql } from './client'
import { CUSTOMERS_BY_QUERY, ORDERS_BY_QUERY } from './queries'
import { executeShopifyTool, shopifyLlmTools, toCard } from './tools'
import * as matchPhoto from './match-photo'
import {
  searchProductsLive,
  listBestSelling,
  listNewArrivals,
  searchCatalogSnapshot,
} from './catalog'
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

  it('builds and parses multi-item cart permalinks', () => {
    expect(
      cartPermalinkMulti('https://shop.example', [
        { variantId: '111', quantity: 1 },
        { variantId: '222', quantity: 2 },
      ]),
    ).toBe('https://shop.example/cart/111:1,222:2')
    expect(
      checkoutPermalinkMulti('https://shop.example', [
        { variantId: '111' },
        { variantId: '222', quantity: 2 },
      ]),
    ).toBe('https://shop.example/cart/111:1,222:2?checkout')
    expect(cartPermalinkMulti('https://shop.example', [])).toBe('')
    expect(cartPermalinkMulti('', [{ variantId: '111' }])).toBe('')
    expect(cartPermalinkMulti('https://shop.example', [{ variantId: '' }])).toBe(
      '',
    )
    expect(
      parseCartPermalink('https://shop.example/cart/111:1,222:2?checkout'),
    ).toEqual([
      { variantId: '111', quantity: 1 },
      { variantId: '222', quantity: 2 },
    ])
    expect(parseCartPermalink('https://shop.example/cart/99:1')).toEqual([
      { variantId: '99', quantity: 1 },
    ])
    expect(parseCartPermalink('https://shop.example/products/red-bag')).toEqual(
      [],
    )
    expect(parseCartPermalink('')).toEqual([])
    expect(parseCartPermalink('/cart/55:3')).toEqual([
      { variantId: '55', quantity: 3 },
    ])
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

  it('formats WhatsApp digits as E.164 for orderCreate', () => {
    expect(toShopifyPhone('918129760955')).toBe('+918129760955')
    expect(toShopifyPhone('+91 81297 60955')).toBe('+918129760955')
    expect(toShopifyPhone('9198')).toBeUndefined()
    expect(toShopifyPhone(null)).toBeUndefined()
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
  it('uses the selected variant checkout URL and caption', () => {
    const card = toCard(
      fixtureProduct({
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Red / S',
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
            title: 'Blue / M',
            sku: 'TOTE-M',
            price: '59.00',
            compareAtPrice: null,
            available: true,
            options: [
              { name: 'Color', value: 'Blue' },
              { name: 'Size', value: 'M' },
            ],
          },
        ],
      }),
      'sku',
      {
        id: 'gid://shopify/ProductVariant/12',
        variantId: '12',
        title: 'Blue / M',
        sku: 'TOTE-M',
        price: '59.00',
        compareAtPrice: null,
        available: true,
        options: [
          { name: 'Color', value: 'Blue' },
          { name: 'Size', value: 'M' },
        ],
      },
    )
    expect(card.checkoutUrl).toBe('https://shop.example/cart/12:1?checkout')
    expect(card.variantId).toBe('12')
    expect(card.caption).toContain('Color: Blue')
    expect(card.caption).toContain('Variants: M')
    expect(card.caption).toContain('59.00')
  })

  it('includes Stock in, variants, and View on an in-stock product', () => {
    const card = toCard(fixtureProduct())
    expect(card.inStock).toBe(true)
    expect(card.caption).toContain('Stock in')
    expect(card.caption).toContain('Color: Red')
    expect(card.caption).not.toContain('Variants:')
    expect(card.caption).toContain(
      'View: https://shop.example/products/red-leather-tote',
    )
    expect(card.caption).not.toMatch(/Buy now/)
    expect(card.caption).not.toContain(card.checkoutUrl)
    expect(card.checkoutUrl).toBe('https://shop.example/cart/11:1?checkout')
    expect(card.retailerId).toBeTruthy()
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
    expect(card.caption).not.toContain('Color:')
    expect(card.caption).not.toContain('Variants:')
    expect(card.caption).toContain(
      'View: https://shop.example/products/red-leather-tote',
    )
    expect(card.caption).not.toMatch(/Buy now/)
    expect(card.caption).not.toContain('https://shop.example/cart/11:1?checkout')
  })

  it('lists sizes on one Variants line and skips Default Title', () => {
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
    expect(card.caption).not.toContain('Default Title')
    expect(card.caption.split('\n')).toEqual([
      'Red Leather Tote',
      '49.00–69.00 USD',
      'Stock in',
      'Variants: S',
      'Color: Red',
      'View: https://shop.example/products/red-leather-tote',
    ])
  })

  it('lists apparel sizes as Variants: M, XL, XXL', () => {
    const card = toCard(
      fixtureProduct({
        variants: ['M', 'XL', 'XXL'].map((size, i) => ({
          id: `gid://shopify/ProductVariant/${20 + i}`,
          variantId: String(20 + i),
          title: size,
          sku: `TOTE-${size}`,
          price: '49.00',
          compareAtPrice: null,
          available: true,
          options: [{ name: 'Size', value: size }],
        })),
      }),
    )
    expect(card.caption).toBe(
      [
        'Red Leather Tote',
        '49.00 USD',
        'Stock in',
        'Variants: M, XL, XXL',
        'View: https://shop.example/products/red-leather-tote',
      ].join('\n'),
    )
  })

  it('crosses out compare-at and shows the sale price', () => {
    const card = toCard(
      fixtureProduct({
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Default',
            sku: 'TOTE-RED',
            price: '49.00',
            compareAtPrice: '69.00',
            available: true,
            options: [{ name: 'Color', value: 'Red' }],
          },
        ],
      }),
    )
    expect(card.caption).toContain('~69.00~ 49.00 USD')
    expect(card.caption).not.toContain('69.00–49.00')
    expect(card.caption).not.toMatch(/^69\.00 /m)
  })

  it('omits compare-at when it is missing or not higher than the sale price', () => {
    expect(toCard(fixtureProduct()).caption).toContain('49.00 USD')
    expect(toCard(fixtureProduct()).caption).not.toContain('~')
    const equal = toCard(
      fixtureProduct({
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Default',
            sku: 'TOTE-RED',
            price: '49.00',
            compareAtPrice: '49.00',
            available: true,
            options: [{ name: 'Color', value: 'Red' }],
          },
        ],
      }),
    )
    expect(equal.caption).toContain('49.00 USD')
    expect(equal.caption).not.toContain('~')
    const lower = toCard(
      fixtureProduct({
        variants: [
          {
            id: 'gid://shopify/ProductVariant/11',
            variantId: '11',
            title: 'Default',
            sku: 'TOTE-RED',
            price: '49.00',
            compareAtPrice: '39.00',
            available: true,
            options: [{ name: 'Color', value: 'Red' }],
          },
        ],
      }),
    )
    expect(lower.caption).toContain('49.00 USD')
    expect(lower.caption).not.toContain('~39.00~')
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

describe('tokensFromDescription', () => {
  it('keeps Indic script tokens', () => {
    const tokens = tokensFromDescription('ചുവപ്പ് സാരി Pournami लाल साड़ी')
    expect(tokens).toContain('pournami')
    expect(tokens.some((t) => /[\u0D00-\u0D7F]/.test(t))).toBe(true)
    expect(tokens.some((t) => /[\u0900-\u097F]/.test(t))).toBe(true)
    expect(tokens.join(' ')).toMatch(/സാരി/)
    expect(tokens.join(' ')).toMatch(/साड़ी/)
  })
})

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

describe('matchProductsToAsk', () => {
  it('keeps only products that match the named ask', () => {
    const redBag = fixtureProduct({
      id: 'gid://shopify/Product/1',
      handle: 'red-bag',
      title: 'Red Bag',
    })
    const blue = fixtureProduct({
      id: 'gid://shopify/Product/2',
      handle: 'blue-sneakers',
      title: 'Blue Sneakers',
      description: 'Canvas runners',
      variants: [],
    })
    const tote = fixtureProduct()
    expect(
      matchProductsToAsk('send me the red bag', [blue, redBag, tote], 3).map(
        (p) => p.title,
      ),
    ).toEqual(['Red Bag'])
  })

  it('matches a SKU and drops unrelated hits', () => {
    const hit = fixtureProduct({
      title: 'Cotton Saree',
      handle: 'cotton-saree',
      variants: [
        {
          id: 'v1',
          variantId: '1',
          title: 'Default',
          sku: 'AB-1234',
          price: '10',
          compareAtPrice: null,
          available: true,
          options: [],
        },
      ],
    })
    const other = fixtureProduct({
      id: 'gid://shopify/Product/9',
      handle: 'other',
      title: 'Other Item',
      variants: [],
    })
    expect(matchProductsToAsk('AB-1234', [other, hit], 3)).toEqual([hit])
  })

  it('builds a search query from spoken filler words', () => {
    expect(productSearchQuery('send me the red bag')).toBe('red bag')
    expect(productSearchQuery('black shirt under 1500')).toBe('black shirt')
  })

  it('parses a stated budget', () => {
    expect(parseBudget('I need a black shirt under ₹1500')).toEqual({ max: 1500 })
    expect(parseBudget('budget 2000 ആണ്')).toEqual({ max: 2000 })
    expect(parseBudget('1500-2000')).toEqual({ min: 1500, max: 2000 })
  })

  it('returns close alternatives when nothing is an exact match', () => {
    const navy = fixtureProduct({
      id: 'gid://shopify/Product/8',
      handle: 'navy-formal-shirt',
      title: 'Navy Formal Shirt',
      priceMin: '1699',
    })
    const shoes = fixtureProduct({
      id: 'gid://shopify/Product/9',
      handle: 'blue-sneakers',
      title: 'Blue Sneakers',
      variants: [],
    })
    const ranked = rankShoppingProducts('black shirt under 1500', [navy, shoes], 3)
    expect(ranked.exact).toBe(false)
    expect(ranked.hits.map((p) => p.title)).toEqual(['Navy Formal Shirt'])
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

  it('defaults new arrivals to 10 products', async () => {
    const gql = vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: { nodes: [] },
    })
    await listNewArrivals({} as SupabaseClient, STORE)
    expect(gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          first: 10,
          sortKey: 'CREATED_AT',
        }),
      }),
    )
  })

  it('lists best selling with Shopify BEST_SELLING sort', async () => {
    const gql = vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: { nodes: [] },
    })
    await listBestSelling({} as SupabaseClient, STORE, 10)
    expect(gql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          first: 10,
          sortKey: 'BEST_SELLING',
          reverse: false,
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
    expect(result.orderCards).toEqual([])
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
    expect(result.orderCards).toEqual([])
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
    expect(result.orderCards).toHaveLength(1)
    expect(result.orderCards?.[0]).toMatchObject({
      orderName: '#1001',
      buttonLabel: 'Track order',
      url: 'https://track.example/1Z999',
    })
  })

  it('returns an order card with name, phone, prices, and tracking URL', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      customers: {
        nodes: [
          {
            displayName: 'Priya',
            phone: '+91 88487 72371',
            defaultAddress: { phone: null },
            orders: {
              nodes: [
                {
                  id: 'gid://shopify/Order/1',
                  name: '#1001',
                  displayFinancialStatus: 'PAID',
                  displayFulfillmentStatus: 'FULFILLED',
                  statusPageUrl: 'https://shop.example/pages/order/abc',
                  totalPriceSet: { shopMoney: { amount: '2499.00', currencyCode: 'INR' } },
                  lineItems: {
                    nodes: [
                      {
                        title: 'Red Tote',
                        quantity: 1,
                        sku: 'TOTE',
                        variantTitle: null,
                        originalTotalSet: {
                          shopMoney: { amount: '2499.00', currencyCode: 'INR' },
                        },
                        discountedTotalSet: {
                          shopMoney: { amount: '2499.00', currencyCode: 'INR' },
                        },
                      },
                    ],
                  },
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
      'lookup_my_orders',
      { order_name: '#1001' },
    )
    const body = JSON.parse(result.json)
    expect(body.orders).toHaveLength(1)
    expect(body.orders[0]).toMatchObject({
      name: '#1001',
      customerName: 'Priya',
      customerPhone: '+91 88487 72371',
      statusPageUrl: 'https://shop.example/pages/order/abc',
    })
    expect(body.orders[0].lineItems[0]).toMatchObject({
      title: 'Red Tote',
      price: '2499.00',
      currency: 'INR',
    })
    expect(result.orderCards).toHaveLength(1)
    expect(result.orderCards?.[0]).toMatchObject({
      orderName: '#1001',
      buttonLabel: 'Track order',
      url: 'https://track.example/1Z999',
    })
    expect(result.orderCards?.[0]?.bodyText).toContain('Name: Priya')
    expect(result.orderCards?.[0]?.bodyText).toContain('Phone: +91 88487 72371')
    expect(result.orderCards?.[0]?.bodyText).toContain('Order: #1001')
    expect(result.orderCards?.[0]?.bodyText).toMatch(/Red Tote/)
  })

  it('order GraphQL queries ask for status page and line prices', () => {
    expect(CUSTOMERS_BY_QUERY).toContain('statusPageUrl')
    expect(CUSTOMERS_BY_QUERY).toContain('discountedTotalSet')
    expect(CUSTOMERS_BY_QUERY).toContain('originalTotalSet')
    expect(ORDERS_BY_QUERY).toContain('statusPageUrl')
    expect(ORDERS_BY_QUERY).toContain('discountedTotalSet')
    expect(ORDERS_BY_QUERY).toContain('displayName')
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
      undefined,
    )
    const body = JSON.parse(result.json)
    expect(body.products[0].title).toBe('Red Leather Tote')
    expect(result.cards[0].imageUrl).toBe('https://cdn.example/tote.jpg')

    spy.mockClear()
    await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        photoMatch: {
          customerImageUrl: 'https://cdn.example/customer.jpg',
          apiKey: 'sk-test',
        },
      },
      'match_product_from_photo',
      { description: 'red leather tote' },
    )
    expect(spy).toHaveBeenCalledWith(
      expect.anything(),
      STORE,
      'red leather tote',
      expect.objectContaining({
        customerImageUrl: 'https://cdn.example/customer.jpg',
        apiKey: 'sk-test',
      }),
    )
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

  it('builds a cart offer from product cards already shown this turn', async () => {
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        productCards: [
          {
            title: 'Red Bag',
            imageUrl: null,
            productUrl: 'https://shop.example/products/red-bag',
            cartUrl: 'https://shop.example/cart/99:1',
            checkoutUrl: 'https://shop.example/cart/99:1?checkout',
            inStock: true,
            caption: 'Red Bag\n49 USD\nStock in',
          },
        ],
      },
      'offer_cart',
      {},
    )
    const body = JSON.parse(result.json)
    expect(body.cart_url).toBe('https://shop.example/cart/99:1')
    expect(body.checkout_url).toBe('https://shop.example/cart/99:1?checkout')
    expect(body.items[0].title).toBe('Red Bag')
    expect(result.cartOffer?.cartUrl).toBe('https://shop.example/cart/99:1')
    expect(result.cards).toEqual([])
  })

  it('flags send_whatsapp_catalog when a Meta catalog id is configured', async () => {
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: { ...STORE, metaCatalogId: '1234567890' },
        contactPhone: null,
      },
      'send_whatsapp_catalog',
      {},
    )
    const body = JSON.parse(result.json)
    expect(body.sent).toBe(true)
    expect(result.sendCatalog).toBe(true)
    expect(result.cards).toEqual([])
  })

  it('does not send a catalog when no Meta catalog id is configured', async () => {
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: null },
      'send_whatsapp_catalog',
      {},
    )
    const body = JSON.parse(result.json)
    expect(body.sent).toBe(false)
    expect(result.sendCatalog).toBeUndefined()
  })

  it('returns 10 product cards for list_best_selling', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: Array.from({ length: 12 }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          handle: `bag-${i + 1}`,
          title: `Bag ${i + 1}`,
          description: 'Bag',
          featuredImage: { url: `https://cdn.example/bag-${i + 1}.jpg` },
          variants: {
            nodes: [
              {
                id: `gid://shopify/ProductVariant/${i + 1}`,
                legacyResourceId: String(100 + i),
                title: 'Default',
                sku: `BAG-${i + 1}`,
                availableForSale: true,
                price: '49.00',
                selectedOptions: [],
              },
            ],
          },
        })),
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'best selling',
      },
      'list_best_selling',
      {},
    )
    expect(result.cards).toHaveLength(12)
    expect(JSON.parse(result.json).products).toHaveLength(12)
  })

  it('returns 10 product cards for list_new_arrivals', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: Array.from({ length: 10 }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          handle: `new-${i + 1}`,
          title: `New ${i + 1}`,
          description: 'New',
          featuredImage: { url: `https://cdn.example/new-${i + 1}.jpg` },
          variants: {
            nodes: [
              {
                id: `gid://shopify/ProductVariant/${i + 1}`,
                legacyResourceId: String(200 + i),
                title: 'Default',
                sku: `NEW-${i + 1}`,
                availableForSale: true,
                price: '29.00',
                selectedOptions: [],
              },
            ],
          },
        })),
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'new arrivals',
      },
      'list_new_arrivals',
      {},
    )
    expect(result.cards).toHaveLength(10)
  })

  it('sends 1 search card when the customer asked for one item', async () => {
    const graphql = vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            handle: 'red-bag',
            title: 'Red Bag',
            description: 'Bag',
            featuredImage: { url: 'https://cdn.example/red-bag.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/1',
                  legacyResourceId: '101',
                  title: 'Default',
                  sku: 'BAG-RED',
                  availableForSale: true,
                  price: '49.00',
                  selectedOptions: [],
                },
              ],
            },
          },
          {
            id: 'gid://shopify/Product/2',
            handle: 'blue-sneakers',
            title: 'Blue Sneakers',
            description: 'Shoes',
            featuredImage: { url: 'https://cdn.example/blue.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/2',
                  legacyResourceId: '102',
                  title: 'Default',
                  sku: 'SNK-BLU',
                  availableForSale: true,
                  price: '80.00',
                  selectedOptions: [],
                },
              ],
            },
          },
        ],
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'send the red bag',
      },
      'search_products',
      { query: 'red bag' },
    )
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].title).toBe('Red Bag')
    expect(graphql).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({ first: 3 }),
      }),
    )
  })

  it('sends every catalog-matched search card for a named product ask', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: Array.from({ length: 6 }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          handle: `red-bag-${i + 1}`,
          title: `Red Bag ${i + 1}`,
          description: 'Bag',
          featuredImage: { url: `https://cdn.example/red-${i + 1}.jpg` },
          variants: {
            nodes: [
              {
                id: `gid://shopify/ProductVariant/${i + 1}`,
                legacyResourceId: String(300 + i),
                title: 'Default',
                sku: `RED-${i + 1}`,
                availableForSale: true,
                price: '49.00',
                selectedOptions: [],
              },
            ],
          },
        })),
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'show me red bags',
      },
      'search_products',
      { query: 'red bags' },
    )
    expect(result.cards).toHaveLength(6)
  })

  it('sends every catalog-matched card for a related-product ask', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: Array.from({ length: 8 }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          handle: `coord-${i + 1}`,
          title: `Coord Set ${i + 1}`,
          description: 'Coord',
          featuredImage: { url: `https://cdn.example/coord-${i + 1}.jpg` },
          variants: {
            nodes: [
              {
                id: `gid://shopify/ProductVariant/${i + 1}`,
                legacyResourceId: String(500 + i),
                title: 'Default',
                sku: `COORD-${i + 1}`,
                availableForSale: true,
                price: '599.00',
                selectedOptions: [],
              },
            ],
          },
        })),
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'related coord set',
      },
      'search_products',
      { query: 'coord set' },
    )
    expect(result.cards).toHaveLength(8)
  })

  it('sends related catalog cards when search has no exact match', async () => {
    vi.spyOn(client, 'shopifyGraphql')
      .mockResolvedValueOnce({ products: { nodes: [] } })
      .mockResolvedValueOnce({
        products: {
          nodes: Array.from({ length: 4 }, (_, i) => ({
            id: `gid://shopify/Product/${i + 1}`,
            handle: `new-${i + 1}`,
            title: `New ${i + 1}`,
            description: 'New',
            featuredImage: { url: `https://cdn.example/new-${i + 1}.jpg` },
            variants: {
              nodes: [
                {
                  id: `gid://shopify/ProductVariant/${i + 1}`,
                  legacyResourceId: String(600 + i),
                  title: 'Default',
                  sku: `NEW-${i + 1}`,
                  availableForSale: true,
                  price: '29.00',
                  selectedOptions: [],
                },
              ],
            },
          })),
        },
      })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'green color dress',
      },
      'search_products',
      { query: 'green dress' },
    )
    expect(result.cards).toHaveLength(4)
    expect(JSON.parse(result.json).note).toMatch(/related catalog/)
  })

  it('lets a tool limit override the inferred search count', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: Array.from({ length: 8 }, (_, i) => ({
          id: `gid://shopify/Product/${i + 1}`,
          handle: `red-bag-${i + 1}`,
          title: `Red Bag ${i + 1}`,
          description: 'Bag',
          featuredImage: { url: `https://cdn.example/bag-${i + 1}.jpg` },
          variants: {
            nodes: [
              {
                id: `gid://shopify/ProductVariant/${i + 1}`,
                legacyResourceId: String(400 + i),
                title: 'Default',
                sku: `BAG-${i + 1}`,
                availableForSale: true,
                price: '49.00',
                selectedOptions: [],
              },
            ],
          },
        })),
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'send the red bag',
      },
      'search_products',
      { query: 'red bag', limit: 5 },
    )
    expect(result.cards).toHaveLength(5)
    expect(result.cards.every((c) => c.title.startsWith('Red Bag'))).toBe(true)
  })

  it('uses spoken customer text when the tool query is empty', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            handle: 'red-bag',
            title: 'Red Bag',
            description: 'Bag',
            featuredImage: { url: 'https://cdn.example/red-bag.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/1',
                  legacyResourceId: '101',
                  title: 'Default',
                  sku: 'BAG-RED',
                  availableForSale: true,
                  price: '49.00',
                  selectedOptions: [],
                },
              ],
            },
          },
        ],
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'I want the red bag',
      },
      'search_products',
      { query: '' },
    )
    expect(result.cards).toHaveLength(1)
    expect(result.cards[0].title).toBe('Red Bag')
  })

  it('filters search hits by budget and notes close alternatives', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      products: {
        nodes: [
          {
            id: 'gid://shopify/Product/1',
            handle: 'navy-formal-shirt',
            title: 'Navy Formal Shirt',
            description: 'Shirt',
            featuredImage: { url: 'https://cdn.example/navy.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/1',
                  legacyResourceId: '11',
                  title: 'Default',
                  sku: 'SHIRT-NVY',
                  availableForSale: true,
                  price: '1499.00',
                  selectedOptions: [],
                },
              ],
            },
          },
          {
            id: 'gid://shopify/Product/2',
            handle: 'black-silk-shirt',
            title: 'Black Silk Shirt',
            description: 'Shirt',
            featuredImage: { url: 'https://cdn.example/silk.jpg' },
            variants: {
              nodes: [
                {
                  id: 'gid://shopify/ProductVariant/2',
                  legacyResourceId: '22',
                  title: 'Default',
                  sku: 'SHIRT-BLK',
                  availableForSale: true,
                  price: '2499.00',
                  selectedOptions: [],
                },
              ],
            },
          },
        ],
      },
    })
    const result = await executeShopifyTool(
      {
        db: {} as SupabaseClient,
        config: STORE,
        contactPhone: null,
        customerText: 'black shirt under 1500',
      },
      'search_products',
      { query: 'black shirt', max_price: 1500 },
    )
    expect(result.cards.map((c) => c.title)).toEqual(['Navy Formal Shirt'])
    expect(JSON.parse(result.json).note).toMatch(/closest catalog options/)
  })

  it('includes send_whatsapp_catalog only when the WhatsApp catalog is on', () => {
    expect(shopifyLlmTools().some((t) => t.name === 'send_whatsapp_catalog')).toBe(
      false,
    )
    expect(
      shopifyLlmTools({ whatsappCatalog: true }).some(
        (t) => t.name === 'send_whatsapp_catalog',
      ),
    ).toBe(true)
  })

  it('returns a note when offer_cart has no shown products', async () => {
    const result = await executeShopifyTool(
      { db: {} as SupabaseClient, config: STORE, contactPhone: null },
      'offer_cart',
      {},
    )
    const body = JSON.parse(result.json)
    expect(body.items).toEqual([])
    expect(body.note).toMatch(/No products have been shown/)
    expect(result.cartOffer).toBeNull()
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
