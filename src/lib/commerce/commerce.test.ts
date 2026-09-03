import { describe, expect, it } from 'vitest'
import { buildOrderDetailsInteractive, parseOrderDetailsParameters } from './order-details'
import { newCommerceReferenceId, isValidReferenceId, assertAmountIdentity } from './money'
import { canTransitionOrderStatus, isCancelAfterPay } from './order-status'
import { parseInboundOrderMessage } from './inbound-order'
import { variantGid, shopifyMoneyFromPaise, WHATSAPP_COMMERCE_TAG } from './shopify-order'
import { isPaymentStatus } from './payment'
import { verifyRazorpayWebhookSignature } from './razorpay'
import { SHOPIFY_PARTNER_SCOPES } from '@/lib/shopify/scopes'

const beneficiary = {
  name: 'Ada Lovelace',
  address_line1: '12 MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  country: 'India',
  postal_code: '560001',
}

describe('order_details builder', () => {
  it('stringifies parameters and keeps amount identity', () => {
    const built = buildOrderDetailsInteractive({
      referenceId: 'wac_abc123',
      catalogId: '111',
      configurationName: 'razorpay_prod',
      accountId: 'acct-1',
      bodyText: 'Review and pay',
      items: [
        { retailer_id: 'BAG-RED', name: 'Red Bag', quantity: 2, amountPaise: 4900 },
      ],
      beneficiary,
    })
    expect(built.interactive.type).toBe('order_details')
    const action = built.interactive.action as {
      name: string
      parameters: string
    }
    expect(action.name).toBe('review_and_pay')
    expect(typeof action.parameters).toBe('string')
    const params = parseOrderDetailsParameters(action.parameters)!
    expect(params.reference_id).toBe('wac_abc123')
    expect(params.currency).toBe('INR')
    expect(params.type).toBe('physical-goods')
    const payment = (params.payment_settings as Array<Record<string, unknown>>)[0]
    expect(payment.type).toBe('payment_gateway')
    const gateway = payment.payment_gateway as Record<string, unknown>
    expect(gateway.type).toBe('razorpay')
    expect(gateway.configuration_name).toBe('razorpay_prod')
    const order = params.order as Record<string, unknown>
    expect(order.catalog_id).toBe('111')
    expect((params.total_amount as { value: number; offset: number }).offset).toBe(100)
    expect((params.total_amount as { value: number }).value).toBe(9800)
    expect(isValidReferenceId('wac_abc123')).toBe(true)
    expect(isValidReferenceId('not a uuid with spaces')).toBe(false)
    expect(newCommerceReferenceId().startsWith('wac_')).toBe(true)
    expect(newCommerceReferenceId().length).toBeLessThanOrEqual(35)
  })

  it('rejects amount mismatch', () => {
    expect(() =>
      assertAmountIdentity({
        subtotal: 100,
        tax: 0,
        shipping: 0,
        discount: 0,
        total: 99,
      }),
    ).toThrow(/must equal/)
  })
})

describe('order_status transitions', () => {
  it('allows processing after pending and blocks cancel after pay', () => {
    expect(canTransitionOrderStatus('pending', 'processing')).toBe(true)
    expect(canTransitionOrderStatus('processing', 'canceled')).toBe(false)
    expect(isCancelAfterPay('processing', 'canceled')).toBe(true)
    expect(isCancelAfterPay('pending', 'canceled')).toBe(false)
  })
})

describe('inbound order parse', () => {
  it('reads catalog cart lines', () => {
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
    expect(parsed?.previewText).toContain('BAG-RED')
  })
})

describe('shopify order mapping', () => {
  it('builds variant GIDs and tags paid WhatsApp orders', () => {
    expect(variantGid('99')).toBe('gid://shopify/ProductVariant/99')
    expect(shopifyMoneyFromPaise(4900)).toBe('49.00')
    expect(WHATSAPP_COMMERCE_TAG).toBe('whatsapp-commerce')
    expect(SHOPIFY_PARTNER_SCOPES).toContain('write_orders')
    expect(SHOPIFY_PARTNER_SCOPES).toContain('write_customers')
  })
})

describe('payment webhook', () => {
  it('only treats type=payment as a payment status', () => {
    expect(isPaymentStatus({ type: 'payment' })).toBe(true)
    expect(isPaymentStatus({ type: 'message' })).toBe(false)
  })

  it('verifies Razorpay HMAC without using SaaS billing keys', () => {
    const crypto = require('crypto') as typeof import('crypto')
    const body = '{"a":1}'
    const secret = 'whsec'
    const sig = crypto.createHmac('sha256', secret).update(body).digest('hex')
    expect(verifyRazorpayWebhookSignature(body, sig, secret)).toBe(true)
    expect(verifyRazorpayWebhookSignature(body, 'nope', secret)).toBe(false)
  })
})
