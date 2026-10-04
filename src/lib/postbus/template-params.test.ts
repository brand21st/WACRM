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
})
