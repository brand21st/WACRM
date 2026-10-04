import { describe, expect, it } from 'vitest'

import { postbusTemplateBodyParams } from './template-params'

describe('postbusTemplateBodyParams', () => {
  it('fills named slots from the template body order', () => {
    const params = postbusTemplateBodyParams(
      'Hi {{1}}, this is {{2}}. Your order {{3}} is booked. Track: {{4}}',
      {
        customer_name: 'Ada',
        shop_name: 'Acme',
        order_number: '1001',
        tracking_number: 'TRK1',
        tracking_url: 'https://track.example/TRK1',
      },
    )
    expect(params[0]).toBe('Ada')
    expect(params[1]).toBe('Acme')
    expect(params[2]).toBe('1001')
    expect(params[3]).toContain('track.example')
  })

  it('fills the live order confirmation template, including amount and address', () => {
    const params = postbusTemplateBodyParams(
      '*Order Confirmed*\n\nHi {{1}}, your order from *{{2}}* has been confirmed.\n\n*Order ID:* {{3}}\n*Amount:* ₹{{4}}\n*Delivery Address:* {{5}}',
      {
        customer_name: 'Akshaj R Das',
        shop_name: 'Postbus Shop',
        order_number: '4296459636924',
        amount: '238',
        delivery_address: 'Christian College Road, Allapuzha, Kerala, 689122',
      },
    )
    expect(params).toEqual([
      'Akshaj R Das',
      'Postbus Shop',
      '4296459636924',
      '238',
      'Christian College Road, Allapuzha, Kerala, 689122',
    ])
  })

  it('never leaves a body slot empty when tracking is not booked yet', () => {
    const params = postbusTemplateBodyParams(
      'Hi {{1}}, your order from *{{2}}* has been confirmed.\n*Order ID:* {{3}}\n*Amount:* ₹{{4}}\n*Delivery Address:* {{5}}',
      { customer_name: 'Neha', shop_name: 'Shop', order_number: '#2457' },
    )
    expect(params.every((value) => value.trim().length > 0)).toBe(true)
    expect(params[2]).toBe('#2457')
    expect(params[3]).toBe('-')
    expect(params[4]).toBe('-')
  })

  it('fills tracking number and tracking link on the in-transit template', () => {
    const params = postbusTemplateBodyParams(
      'Hi {{1}}, your shipment from *{{2}}* is currently in transit.\n*Order ID:* {{3}}\n*Tracking Number:* {{4}}\n\nTrack your shipment here:\n{{5}}',
      {
        customer_name: 'Neha',
        shop_name: 'Shop',
        order_number: '#2457',
        tracking_number: 'AB123456789IN',
        tracking_url: 'https://track.example/AB123456789IN',
      },
    )
    expect(params).toEqual([
      'Neha',
      'Shop',
      '#2457',
      'AB123456789IN',
      'https://track.example/AB123456789IN',
    ])
  })
})
