import { describe, expect, it } from 'vitest'

import {
  appendDiscountToCheckoutUrl,
  attachShopContext,
  notificationActionsForTopic,
  urlPartial,
} from './notification-payload'
import { buildBodyParams, mergeRules } from './notification-triggers'
import {
  isShopifyNotificationTopic,
  SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS,
  SHOPIFY_WEBHOOK_TOPICS,
} from './webhook-topics'

const CUSTOMER = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone: '+14155550123',
  email: 'ada@example.com',
}

describe('appendDiscountToCheckoutUrl', () => {
  it('appends discount to a checkout URL', () => {
    expect(
      appendDiscountToCheckoutUrl(
        'https://shop.example/checkouts/abc?key=1',
        'SAVE10',
      ),
    ).toBe('https://shop.example/checkouts/abc?key=1&discount=SAVE10')
  })

  it('does not overwrite an existing discount param', () => {
    expect(
      appendDiscountToCheckoutUrl(
        'https://shop.example/checkouts/abc?discount=OLD',
        'NEW',
      ),
    ).toBe('https://shop.example/checkouts/abc?discount=OLD')
  })
})

describe('notificationActionsForTopic', () => {
  it('sends new_order and cancels abandoned checkout on orders/create', () => {
    const actions = notificationActionsForTopic('orders/create', {
      id: 1001,
      name: '#1001',
      order_number: 1001,
      order_status_url: 'https://shop.example/123/orders/abc/authenticate',
      checkout_token: 'chk_1',
      email: 'ada@example.com',
      customer: CUSTOMER,
      current_total_price: '42.00',
      currency: 'INR',
      shipping_address: {
        address1: '12 Church St',
        city: 'Kochi',
        province: 'Kerala',
        zip: '682001',
        country: 'India',
      },
      line_items: [
        { title: 'Silk sari', quantity: 2, variant_title: 'Red' },
        { title: 'Blouse', quantity: 1 },
      ],
    })
    expect(actions.map((a) => a.kind)).toEqual(['cancel_abandoned', 'send'])
    expect(actions[1]?.trigger).toBe('new_order')
    expect(actions[1]?.fields.order_name).toBe('#1001')
    expect(actions[1]?.fields.order_number).toBe('1001')
    expect(actions[1]?.fields.customer_first_name).toBe('Ada')
    expect(actions[1]?.fields.customer_last_name).toBe('Lovelace')
    expect(actions[1]?.fields.order_status_url).toContain('/orders/abc/')
    expect(actions[1]?.fields.order_status_url_partial).toBe(
      '123/orders/abc/authenticate',
    )
    expect(actions[1]?.fields.product_details).toBe('2× Silk sari (Red), 1× Blouse')
    expect(actions[1]?.fields.customer_address).toBe(
      '12 Church St, Kochi, Kerala, 682001, India',
    )
    expect(actions[0]?.cancelIds).toContain('chk_1')
  })

  it('sends processing on orders/paid when unfulfilled', () => {
    const actions = notificationActionsForTopic('orders/paid', {
      id: 1001,
      name: '#1001',
      fulfillment_status: null,
      customer: CUSTOMER,
    })
    expect(actions).toEqual([
      expect.objectContaining({ kind: 'send', trigger: 'processing' }),
    ])
  })

  it('skips processing when the order is already fulfilled', () => {
    expect(
      notificationActionsForTopic('orders/paid', {
        id: 1001,
        fulfillment_status: 'fulfilled',
        customer: CUSTOMER,
      }),
    ).toEqual([])
  })

  it('queues abandoned checkout with discount URL after a delay', () => {
    const actions = notificationActionsForTopic(
      'checkouts/update',
      {
        token: 'chk_9',
        phone: '+14155550123',
        abandoned_checkout_url: 'https://shop.example/checkouts/chk_9',
        customer: CUSTOMER,
        completed_at: null,
      },
      { delayHours: 2, daysAfter: 3, discountCode: 'SAVE10' },
    )
    expect(actions).toHaveLength(1)
    expect(actions[0]?.kind).toBe('queue')
    expect(actions[0]?.trigger).toBe('checkout_abandoned')
    expect(actions[0]?.delayMs).toBe(2 * 60 * 60 * 1000)
    expect(actions[0]?.fields.checkout_url).toContain('discount=SAVE10')
    expect(actions[0]?.fields.abandoned_checkout_url).toBe(
      actions[0]?.fields.checkout_url,
    )
    expect(actions[0]?.fields.checkout_url_partial).toBe(
      'checkouts/chk_9?discount=SAVE10',
    )
    expect(actions[0]?.fields.discount_code).toBe('SAVE10')
  })

  it('cancels abandoned checkout when the checkout is completed', () => {
    const actions = notificationActionsForTopic('checkouts/update', {
      token: 'chk_9',
      completed_at: '2026-08-25T10:00:00Z',
      customer: CUSTOMER,
    })
    expect(actions[0]?.kind).toBe('cancel_abandoned')
  })

  it('sends fulfilled on fulfillments/create without a tracking trigger', () => {
    const actions = notificationActionsForTopic('fulfillments/create', {
      id: 55,
      order_id: 1001,
      tracking_number: '1Z999',
      tracking_url: 'https://track.example/1Z999',
      tracking_company: 'UPS',
      destination: { phone: '+14155550123' },
    })
    expect(actions.map((a) => a.trigger)).toEqual(['fulfilled'])
    expect(actions[0]?.fields.tracking_number).toBe('1Z999')
    expect(actions[0]?.fields.tracking_url_partial).toBe('1Z999')
  })

  it('sends tracking on fulfillments/update when tracking appears', () => {
    const actions = notificationActionsForTopic('fulfillments/update', {
      id: 55,
      tracking_number: '1Z999',
      tracking_url: 'https://track.example/1Z999',
    })
    expect(actions[0]?.trigger).toBe('tracking')
  })

  it('sends delivered and queues after_delivered on delivered events', () => {
    const actions = notificationActionsForTopic(
      'fulfillment_events/create',
      { id: 9, fulfillment_id: 55, status: 'delivered' },
      { delayHours: 1, daysAfter: 3, discountCode: '' },
    )
    expect(actions.map((a) => a.kind)).toEqual(['send', 'queue'])
    expect(actions[0]?.trigger).toBe('delivered')
    expect(actions[1]?.trigger).toBe('after_delivered')
    expect(actions[1]?.delayMs).toBe(3 * 24 * 60 * 60 * 1000)
  })

  it('ignores non-delivered fulfillment events', () => {
    expect(
      notificationActionsForTopic('fulfillment_events/create', {
        status: 'in_transit',
        fulfillment_id: 55,
      }),
    ).toEqual([])
  })

  it('sends refund and return_request', () => {
    expect(
      notificationActionsForTopic('refunds/create', {
        id: 3,
        order_id: 1001,
        transactions: [{ amount: '10.00' }],
      })[0],
    ).toMatchObject({ trigger: 'refund', fields: { refund_amount: '10' } })
    expect(
      notificationActionsForTopic('returns/request', {
        id: 8,
        order: { name: '#1001', customer: CUSTOMER },
      })[0]?.trigger,
    ).toBe('return_request')
  })
})

describe('urlPartial / attachShopContext', () => {
  it('strips origin from a URL for button suffixes', () => {
    expect(urlPartial('https://shop.example/checkouts/abc?key=1')).toBe(
      'checkouts/abc?key=1',
    )
    expect(urlPartial('')).toBe('')
  })

  it('fills shop_name and currency without overwriting payload values', () => {
    const attached = attachShopContext(
      { shop_name: '', currency: 'INR', checkout_url: 'https://s.example/c' },
      { shopName: 'Aurimo', currency: 'USD' },
    )
    expect(attached.shop_name).toBe('Aurimo')
    expect(attached.currency).toBe('INR')
    expect(attached.checkout_url_partial).toBe('c')
    expect(attached.abandoned_checkout_url).toBe('https://s.example/c')
  })
})

describe('buildBodyParams / mergeRules', () => {
  it('fills positional body params from the variable map', () => {
    expect(
      buildBodyParams(
        { '1': 'customer_first_name', '2': 'checkout_url' },
        { customer_first_name: 'Ada', checkout_url: 'https://c' },
      ),
    ).toEqual(['Ada', 'https://c'])
  })

  it('fills missing trigger rows with defaults', () => {
    const rules = mergeRules([
      {
        trigger_key: 'new_order',
        is_enabled: true,
        template_name: 'order_confirm',
        template_language: 'en',
        variable_map: { '1': 'order_name' },
        config: {},
      },
    ])
    expect(rules).toHaveLength(9)
    expect(rules[0]?.template_name).toBe('order_confirm')
    expect(rules.find((r) => r.trigger_key === 'checkout_abandoned')?.config.delay_hours).toBe(1)
  })
})

describe('webhook topics', () => {
  it('registers order-lifecycle topics alongside catalog and pages', () => {
    expect(SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS).toContain('orders/create')
    expect(SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS).toContain('checkouts/update')
    expect(isShopifyNotificationTopic('orders/create')).toBe(true)
    expect(isShopifyNotificationTopic('products/create')).toBe(false)
    expect(SHOPIFY_WEBHOOK_TOPICS).toEqual(
      expect.arrayContaining(['products/create', 'orders/create', 'refunds/create']),
    )
  })
})
