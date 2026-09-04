import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphql = vi.fn()

vi.mock('@/lib/shopify/client', () => ({
  ShopifyError: class ShopifyError extends Error {
    constructor(
      message: string,
      readonly status = 502,
      readonly code = 'shopify_error',
    ) {
      super(message)
      this.name = 'ShopifyError'
    }
  },
  shopifyGraphql: (...args: unknown[]) => graphql(...args),
}))

import {
  WHATSAPP_PAYMENT_GATEWAY,
  createPaidShopifyOrder,
  isAlreadyPaidUserError,
  markShopifyOrderAsPaid,
  paidShopifyOrderCreateVariables,
  shopifyMoneyFromPaise,
} from './shopify-order'
import type { ShopifyStoreConfig } from '@/lib/shopify/types'

const config: ShopifyStoreConfig = {
  accountId: 'acct-1',
  shopDomain: 'acme.myshopify.com',
  accessToken: 'shpat',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'INR',
  metaCatalogId: '111',
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 1,
}

const args = {
  config,
  referenceId: 'wac_1',
  phone: '9198',
  beneficiary: {
    name: 'Ada Lovelace',
    address_line1: '12 MG',
    city: 'Bengaluru',
    state: 'KA',
    country: 'India',
    postal_code: '560001',
  },
  lines: [
    {
      retailer_id: 'BAG-RED',
      name: 'Red Bag',
      quantity: 1,
      amountPaise: 4900,
      variantId: '99',
      productId: '42',
      sku: 'BAG-RED',
    },
  ],
  totalPaise: 4900,
  authorizationCode: 'pay_1',
}

describe('paidShopifyOrderCreateVariables', () => {
  it('creates the order as pending with a WhatsApp SALE transaction', () => {
    const variables = paidShopifyOrderCreateVariables(args)
    expect(variables.order.financialStatus).toBe('PENDING')
    expect(variables.order.transactions).toEqual([
      {
        kind: 'SALE',
        status: 'SUCCESS',
        gateway: WHATSAPP_PAYMENT_GATEWAY,
        authorizationCode: 'pay_1',
        amountSet: {
          shopMoney: {
            amount: shopifyMoneyFromPaise(4900),
            currencyCode: 'INR',
          },
        },
      },
    ])
  })
})

describe('createPaidShopifyOrder', () => {
  beforeEach(() => {
    graphql.mockReset()
  })

  it('creates the order then the caller marks it paid', async () => {
    graphql.mockResolvedValueOnce({
      orderCreate: { userErrors: [], order: { id: 'gid://shopify/Order/1', name: '#1001' } },
    })

    const created = await createPaidShopifyOrder(args)
    expect(created).toEqual({ id: 'gid://shopify/Order/1', name: '#1001' })
    expect(graphql).toHaveBeenCalledTimes(1)
    expect(graphql.mock.calls[0][0].variables.order.financialStatus).toBe('PENDING')
    expect(graphql.mock.calls[0][0].variables.order.transactions[0]).toMatchObject({
      kind: 'SALE',
      status: 'SUCCESS',
      gateway: WHATSAPP_PAYMENT_GATEWAY,
    })
  })
})

describe('markShopifyOrderAsPaid', () => {
  beforeEach(() => {
    graphql.mockReset()
  })

  it('ignores already-paid userErrors', async () => {
    graphql.mockResolvedValue({
      orderMarkAsPaid: {
        userErrors: [{ message: 'Order cannot be marked as paid.' }],
        order: { id: 'gid://shopify/Order/1', name: '#1001' },
      },
    })
    await expect(
      markShopifyOrderAsPaid({ config, orderId: 'gid://shopify/Order/1' }),
    ).resolves.toBeUndefined()
  })

  it('throws other mark-as-paid errors', async () => {
    graphql.mockResolvedValue({
      orderMarkAsPaid: {
        userErrors: [{ message: 'Not found' }],
      },
    })
    await expect(
      markShopifyOrderAsPaid({ config, orderId: 'gid://shopify/Order/missing' }),
    ).rejects.toThrow(/Not found/)
  })
})

describe('isAlreadyPaidUserError', () => {
  it('matches Shopify already-paid copy', () => {
    expect(isAlreadyPaidUserError('Order cannot be marked as paid.')).toBe(true)
    expect(isAlreadyPaidUserError('Not found')).toBe(false)
  })
})
