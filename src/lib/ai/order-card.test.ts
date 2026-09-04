import { describe, expect, it } from 'vitest'
import type { ShopifyOrderHit } from '@/lib/shopify/types'
import {
  TRACK_ORDER_BUTTON_LABEL,
  VIEW_ORDER_BUTTON_LABEL,
  formatOrderMoney,
  orderCardBody,
  orderCardCta,
  orderCardFromHit,
  orderCardsFromHits,
  stripOrderUrlsFromReply,
} from './order-card'

function hit(overrides: Partial<ShopifyOrderHit> = {}): ShopifyOrderHit {
  return {
    id: 'gid://shopify/Order/1',
    name: '#1001',
    financialStatus: 'PAID',
    fulfillmentStatus: 'FULFILLED',
    createdAt: '2026-01-01T00:00:00Z',
    total: '2698.00',
    currency: 'INR',
    customerName: 'Priya',
    customerPhone: '+91 88487 72371',
    statusPageUrl: 'https://shop.example/pages/order/abc',
    lineItems: [
      {
        title: 'Red Tote',
        quantity: 1,
        sku: 'TOTE',
        variantTitle: null,
        price: '2499.00',
        currency: 'INR',
      },
      {
        title: 'Socks',
        quantity: 2,
        sku: 'SOCK',
        variantTitle: null,
        price: '199.00',
        currency: 'INR',
      },
    ],
    tracking: [
      {
        number: '1Z999',
        url: 'https://track.example/1Z999',
        company: 'UPS',
        status: 'SUCCESS',
      },
    ],
    ...overrides,
  }
}

describe('orderCardCta', () => {
  it('uses Track order when a tracking URL exists', () => {
    expect(orderCardCta(hit())).toEqual({
      buttonLabel: TRACK_ORDER_BUTTON_LABEL,
      url: 'https://track.example/1Z999',
    })
    expect(TRACK_ORDER_BUTTON_LABEL.length).toBeLessThanOrEqual(20)
  })

  it('falls back to View order on the Shopify status page', () => {
    expect(
      orderCardCta(
        hit({
          tracking: [{ number: '1Z999', url: null, company: 'UPS', status: 'SUCCESS' }],
        }),
      ),
    ).toEqual({
      buttonLabel: VIEW_ORDER_BUTTON_LABEL,
      url: 'https://shop.example/pages/order/abc',
    })
    expect(VIEW_ORDER_BUTTON_LABEL.length).toBeLessThanOrEqual(20)
  })

  it('has no button when neither URL exists', () => {
    expect(
      orderCardCta(
        hit({
          tracking: [],
          statusPageUrl: null,
        }),
      ),
    ).toEqual({ buttonLabel: null, url: null })
  })
})

describe('orderCardBody', () => {
  it('lists name, phone, order id, products, and total', () => {
    const body = orderCardBody(hit())
    expect(body).toContain('Name: Priya')
    expect(body).toContain('Phone: +91 88487 72371')
    expect(body).toContain('Order: #1001')
    expect(body).toMatch(/1 × Red Tote/)
    expect(body).toMatch(/2 × Socks/)
    expect(body).toMatch(/2499|2,499/)
    expect(body).toMatch(/199/)
    expect(body).toMatch(/Total:/)
    expect(body).toMatch(/2698|2,698/)
  })

  it('falls back to the WhatsApp contact phone', () => {
    const body = orderCardBody(hit({ customerPhone: null }), '918848772371')
    expect(body).toContain('Phone: 918848772371')
  })
})

describe('orderCardFromHit', () => {
  it('builds a Track order card', () => {
    const card = orderCardFromHit(hit())
    expect(card.orderName).toBe('#1001')
    expect(card.buttonLabel).toBe(TRACK_ORDER_BUTTON_LABEL)
    expect(card.url).toBe('https://track.example/1Z999')
    expect(card.bodyText).toContain('Order: #1001')
  })
})

describe('orderCardsFromHits', () => {
  it('caps at three cards', () => {
    const cards = orderCardsFromHits([
      hit({ name: '#1' }),
      hit({ name: '#2' }),
      hit({ name: '#3' }),
      hit({ name: '#4' }),
    ])
    expect(cards).toHaveLength(3)
    expect(cards.map((c) => c.orderName)).toEqual(['#1', '#2', '#3'])
  })
})

describe('formatOrderMoney', () => {
  it('returns empty when the amount is missing', () => {
    expect(formatOrderMoney(null, 'INR')).toBe('')
    expect(formatOrderMoney('', 'INR')).toBe('')
  })
})

describe('stripOrderUrlsFromReply', () => {
  it('removes tracking URLs and leftover Track labels', () => {
    expect(
      stripOrderUrlsFromReply(
        'Here is order #1001. Track order: https://track.example/1Z999',
        [orderCardFromHit(hit())],
      ),
    ).toBe('Here is order #1001.')
  })
})
