import { describe, expect, it } from 'vitest'
import {
  shopifyWebhookOrderGid,
  shopifyWebhookOrderNumericId,
} from './webhook-order-id'

describe('shopifyWebhookOrderNumericId', () => {
  it('uses order_id on fulfillment payloads, not the fulfillment id', () => {
    expect(
      shopifyWebhookOrderNumericId({
        id: 999888,
        admin_graphql_api_id: 'gid://shopify/Fulfillment/999888',
        order_id: 1001,
      }),
    ).toBe('1001')
  })

  it('uses a nested order GID', () => {
    expect(
      shopifyWebhookOrderNumericId({
        id: 55,
        order: { admin_graphql_api_id: 'gid://shopify/Order/42', id: 42 },
      }),
    ).toBe('42')
  })

  it('does not invent an Order GID from a fulfillment-only payload', () => {
    expect(
      shopifyWebhookOrderNumericId({
        id: 999888,
        admin_graphql_api_id: 'gid://shopify/Fulfillment/999888',
      }),
    ).toBe('')
    expect(
      shopifyWebhookOrderGid({
        id: 999888,
        admin_graphql_api_id: 'gid://shopify/Fulfillment/999888',
      }),
    ).toBe('')
  })

  it('keeps a real Order GID', () => {
    expect(
      shopifyWebhookOrderGid({
        admin_graphql_api_id: 'gid://shopify/Order/1001',
      }),
    ).toBe('gid://shopify/Order/1001')
  })
})
