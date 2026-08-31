import crypto from 'crypto'
import { describe, expect, it } from 'vitest'

import {
  verifyShopifyOAuthHmac,
  verifyShopifyWebhookHmac,
} from './hmac'

describe('shopify hmac', () => {
  const secret = 'shpss_test_secret_key'

  it('verifies OAuth redirect HMAC', () => {
    const params = new URLSearchParams({
      code: 'auth_code_123',
      shop: 'acme.myshopify.com',
      state: 'nonce',
      timestamp: '1700000000',
    })
    const pairs: string[] = []
    for (const [key, value] of params.entries()) {
      pairs.push(`${key}=${value}`)
    }
    pairs.sort()
    const message = pairs.join('&')
    const hmac = crypto.createHmac('sha256', secret).update(message).digest('hex')
    params.set('hmac', hmac)

    expect(verifyShopifyOAuthHmac(params, secret)).toBe(true)
    expect(verifyShopifyOAuthHmac(params, 'wrong')).toBe(false)
  })

  it('verifies webhook HMAC', () => {
    const body = '{"id":1}'
    const header = crypto
      .createHmac('sha256', secret)
      .update(body, 'utf8')
      .digest('base64')
    expect(verifyShopifyWebhookHmac(body, header, secret)).toBe(true)
    expect(verifyShopifyWebhookHmac(body, 'bad', secret)).toBe(false)
  })
})
