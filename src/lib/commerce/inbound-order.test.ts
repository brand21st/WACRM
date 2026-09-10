import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import { formatCurrency } from '@/lib/currency'
import { enrichInboundCartItems } from './enrich-cart-items'
import {
  formatCartMoney,
  formatInboundOrderPreview,
  parseInboundOrderMessage,
  pickCartDisplayPrice,
  webhookMessageFromInboundCart,
} from './inbound-order'

describe('pickCartDisplayPrice', () => {
  it('replaces a ₹1 stub with compare-at', () => {
    expect(
      pickCartDisplayPrice({ whatsapp: 1, catalog: 1, compareAt: 508 }),
    ).toEqual({ unit: 508 })
  })

  it('keeps a real sale price and the compare-at', () => {
    expect(
      pickCartDisplayPrice({ whatsapp: 408, catalog: 408, compareAt: 508 }),
    ).toEqual({ unit: 408, compareAt: 508 })
  })

  it('keeps the exact catalog variant sale (544.7) and MRP', () => {
    expect(
      pickCartDisplayPrice({ whatsapp: 1, catalog: 544.7, compareAt: 655 }),
    ).toEqual({ unit: 544.7, compareAt: 655 })
  })
})

describe('formatCartMoney', () => {
  it('matches the Catalog list formatter', () => {
    expect(formatCartMoney(508, 'INR')).toBe(formatCurrency(508, 'INR'))
    expect(formatCartMoney(544.7, 'INR')).toBe(formatCurrency(544.7, 'INR'))
    expect(formatCartMoney(499, 'INR')).toBe(formatCurrency(499, 'INR'))
  })
})

describe('webhookMessageFromInboundCart', () => {
  it('round-trips a stored cart into the webhook order shape', () => {
    const message = webhookMessageFromInboundCart({
      catalog_id: '153',
      items: [{ product_retailer_id: '47999459590302', quantity: 1, item_price: 544.7 }],
    })
    expect(parseInboundOrderMessage(message)?.items[0]).toEqual(
      expect.objectContaining({
        product_retailer_id: '47999459590302',
        quantity: 1,
        item_price: 544.7,
      }),
    )
  })
})

describe('parseInboundOrderMessage', () => {
  it('reads catalog cart lines without requiring a name', () => {
    const parsed = parseInboundOrderMessage({
      order: {
        catalog_id: '111',
        product_items: [
          { product_retailer_id: 'BAG-RED', quantity: 2, item_price: 49, currency: 'INR' },
        ],
      },
    })
    expect(parsed?.items[0]).toEqual(
      expect.objectContaining({
        product_retailer_id: 'BAG-RED',
        quantity: 2,
        item_price: 49,
      }),
    )
    expect(parsed?.items[0]?.name).toBeUndefined()
    expect(parsed?.previewText).toContain('BAG-RED')
  })
})

describe('formatInboundOrderPreview', () => {
  it('uses the product name and cart total after enrich', () => {
    const text = formatInboundOrderPreview([
      {
        product_retailer_id: 'BAG-RED',
        quantity: 1,
        name: 'Red Bag',
        item_price: 499,
        currency: 'INR',
      },
    ])
    expect(text).toContain('Red Bag × 1')
    expect(text).toContain(formatCartMoney(499, 'INR'))
    expect(text).not.toContain('BAG-RED')
  })

  it('uses compare-at for the preview total when the line is a ₹1 stub', () => {
    const text = formatInboundOrderPreview([
      {
        product_retailer_id: '47869262004382',
        quantity: 1,
        name: 'Rayon Aline kurti',
        item_price: 1,
        compare_at_price: 508,
        currency: 'INR',
      },
    ])
    expect(text).toContain(formatCartMoney(508, 'INR'))
    expect(text).not.toContain(formatCartMoney(1, 'INR'))
  })
})

describe('enrichInboundCartItems', () => {
  it('resolves a retailer id to the catalog title', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [{ id: 'p1', account_id: 'acct-a', title: 'Red Bag', currency: 'INR' }],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Default',
          price: 599,
          currency: 'INR',
          retailer_id: 'BAG-RED',
        },
      ],
      catalog_media: [
        {
          id: 'm1',
          account_id: 'acct-a',
          product_id: 'p1',
          url: 'https://cdn.example/red-bag.jpg',
          role: 'hero',
          sort_order: 0,
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      { product_retailer_id: 'BAG-RED', quantity: 1 },
    ])
    expect(items[0]).toEqual(
      expect.objectContaining({
        name: 'Red Bag',
        item_price: 599,
        currency: 'INR',
        image_url: 'https://cdn.example/red-bag.jpg',
      }),
    )
  })

  it('prefers the catalog price over the WhatsApp line price', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [{ id: 'p1', account_id: 'acct-a', title: 'Red Bag' }],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Default',
          price: 599,
          currency: 'INR',
          retailer_id: 'BAG-RED',
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      {
        product_retailer_id: 'BAG-RED',
        quantity: 1,
        item_price: 1,
        currency: 'INR',
      },
    ])
    expect(items[0]?.name).toBe('Red Bag')
    expect(items[0]?.item_price).toBe(599)
  })

  it('uses compare-at when the catalog sale price is a ₹1 stub', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'p1', account_id: 'acct-a', title: 'Rayon Aline kurti' },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Reddish maroon / 2XL / Rayon',
          price: 1,
          compare_at_price: 508,
          currency: 'INR',
          retailer_id: 'shopify_IN_8752741646494_47869262004382',
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      {
        product_retailer_id: '47869262004382',
        quantity: 1,
        item_price: 1,
        currency: 'INR',
      },
    ])
    expect(items[0]?.item_price).toBe(508)
    expect(items[0]?.compare_at_price).toBeUndefined()
  })

  it('keeps the catalog sale and MRP for a real discount', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'p1', account_id: 'acct-a', title: 'Rayon side slit Coord sets' },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Light Yellow / L / Rayon',
          price: 544.7,
          compare_at_price: 655,
          currency: 'INR',
          retailer_id: 'shopify_IN_8791731044510_47999459590302',
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      {
        product_retailer_id: '47999459590302',
        quantity: 1,
        item_price: 1,
        currency: 'INR',
      },
    ])
    expect(items[0]?.item_price).toBe(544.7)
    expect(items[0]?.compare_at_price).toBe(655)
  })

  it('leaves an unknown retailer id unchanged', async () => {
    const db = createCatalogMemoryDb()
    const items = await enrichInboundCartItems(db, 'acct-a', [
      { product_retailer_id: '48218084933790', quantity: 1 },
    ])
    expect(items[0]).toEqual({
      product_retailer_id: '48218084933790',
      quantity: 1,
    })
  })

  it('appends a non-default variant title', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [{ id: 'p1', account_id: 'acct-a', title: 'Kurti' }],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Red / S',
          price: 499,
          retailer_id: 'K-RED-S',
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      { product_retailer_id: 'K-RED-S', quantity: 2 },
    ])
    expect(items[0]?.name).toBe('Kurti — Red / S')
  })

  it('resolves a numeric WhatsApp variant id to catalog media', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'p1', account_id: 'acct-a', title: 'Rayon Aline kurti', currency: 'INR' },
      ],
      catalog_variants: [
        {
          id: 'v1',
          account_id: 'acct-a',
          product_id: 'p1',
          title: 'Reddish maroon / 2XL / Rayon',
          price: 1,
          compare_at_price: 508,
          currency: 'INR',
          retailer_id: 'shopify_IN_8752741646494_47869262004382',
        },
      ],
      catalog_media: [
        {
          id: 'm1',
          account_id: 'acct-a',
          product_id: 'p1',
          url: 'https://cdn.example/aline.jpg',
          role: 'hero',
          sort_order: 0,
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      { product_retailer_id: '47869262004382', quantity: 1, item_price: 1, currency: 'INR' },
    ])
    expect(items[0]?.name).toBe('Rayon Aline kurti — Reddish maroon / 2XL / Rayon')
    expect(items[0]?.item_price).toBe(508)
    expect(items[0]?.compare_at_price).toBeUndefined()
    expect(items[0]?.image_url).toBe('https://cdn.example/aline.jpg')
  })

  it('resolves a numeric Shopify variant id from the snapshot', async () => {
    const db = createCatalogMemoryDb({
      shopify_catalog_products: [
        {
          shopify_product_id: '99',
          account_id: 'acct-a',
          title: 'Silk Saree',
          image_url: 'https://cdn.example/saree.jpg',
          variant_summary: [
            {
              id: 'gid://shopify/ProductVariant/48218084933790',
              variantId: '48218084933790',
              title: 'Default',
              sku: 'SAREE',
              price: '899',
              compareAtPrice: null,
              available: true,
              options: [],
            },
          ],
        },
      ],
    })
    const items = await enrichInboundCartItems(db, 'acct-a', [
      { product_retailer_id: '48218084933790', quantity: 1 },
    ])
    expect(items[0]?.name).toBe('Silk Saree')
    expect(items[0]?.item_price).toBe(899)
    expect(items[0]?.image_url).toBe('https://cdn.example/saree.jpg')
  })
})
