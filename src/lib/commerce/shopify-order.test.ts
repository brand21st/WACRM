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
  STANDARD_DELIVERY_TITLE,
  VACHAT_ORDER_TAG,
  WHATSAPP_COMMERCE_DISPLAY_TAG,
  WHATSAPP_COMMERCE_TAG,
  WHATSAPP_PAYMENT_GATEWAY,
  createPaidShopifyOrder,
  isAlreadyPaidUserError,
  isInvalidPhoneUserError,
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
  phone: '918129760955',
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
  it('creates a paid Shopify order with a WhatsApp SALE transaction', () => {
    const variables = paidShopifyOrderCreateVariables(args)
    expect(variables.order.financialStatus).toBe('PAID')
    expect(variables.order.lineItems).toEqual([
      {
        variantId: 'gid://shopify/ProductVariant/99',
        quantity: 1,
        requiresShipping: true,
        title: 'Red Bag',
      },
    ])
    expect(variables.order.phone).toBe('+918129760955')
    expect(variables.order.tags).toEqual([
      WHATSAPP_COMMERCE_TAG,
      WHATSAPP_COMMERCE_DISPLAY_TAG,
      VACHAT_ORDER_TAG,
      'wac_1',
    ])
    expect(variables.order.shippingLines).toEqual([
      {
        title: STANDARD_DELIVERY_TITLE,
        code: 'standard',
        priceSet: {
          shopMoney: { amount: '0.00', currencyCode: 'INR' },
        },
      },
    ])
    expect(variables.order.customer).toBeUndefined()
    expect(variables.order.email).toBeUndefined()
    expect(variables.options.sendReceipt).toBe(false)
    expect(
      (variables.order.shippingAddress as { phone?: string }).phone,
    ).toBe('+918129760955')
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

  it('sends a Shopify receipt when the customer gave an email', () => {
    const variables = paidShopifyOrderCreateVariables({
      ...args,
      email: 'ada@example.com',
      customerId: 'gid://shopify/Customer/9',
    })
    expect(variables.order.email).toBe('ada@example.com')
    expect(variables.order.customer).toEqual({
      toAssociate: { id: 'gid://shopify/Customer/9' },
    })
    expect(variables.options.sendReceipt).toBe(true)
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
    expect(graphql.mock.calls[0][0].variables.order.financialStatus).toBe('PAID')
    expect(graphql.mock.calls[0][0].variables.order.lineItems[0].requiresShipping).toBe(
      true,
    )
    expect(graphql.mock.calls[0][0].variables.order.transactions[0]).toMatchObject({
      kind: 'SALE',
      status: 'SUCCESS',
      gateway: WHATSAPP_PAYMENT_GATEWAY,
    })
  })

  it('retries without a phone when Shopify rejects the WhatsApp number', async () => {
    graphql
      .mockResolvedValueOnce({
        orderCreate: { userErrors: [{ message: 'Phone is invalid' }], order: null },
      })
      .mockResolvedValueOnce({
        orderCreate: {
          userErrors: [],
          order: { id: 'gid://shopify/Order/2', name: '#1002' },
        },
      })

    const created = await createPaidShopifyOrder(args)
    expect(created).toEqual({ id: 'gid://shopify/Order/2', name: '#1002' })
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[0][0].variables.order.phone).toBe('+918129760955')
    expect(graphql.mock.calls[1][0].variables.order.phone).toBeUndefined()
    expect(
      graphql.mock.calls[1][0].variables.order.shippingAddress.phone,
    ).toBeUndefined()
  })

  it('retries without a customer when Shopify rejects the customer input', async () => {
    graphql
      .mockRejectedValueOnce(
        new Error(
          'Variable $order of type OrderCreateOrderInput! was provided invalid value for customer.toSet (Field is not defined on OrderCreateCustomerInput)',
        ),
      )
      .mockResolvedValueOnce({
        orderCreate: {
          userErrors: [],
          order: { id: 'gid://shopify/Order/3', name: '#1003' },
        },
      })

    const created = await createPaidShopifyOrder({
      ...args,
      customerId: 'gid://shopify/Customer/9',
    })
    expect(created).toEqual({ id: 'gid://shopify/Order/3', name: '#1003' })
    expect(graphql).toHaveBeenCalledTimes(2)
    expect(graphql.mock.calls[0][0].variables.order.customer).toEqual({
      toAssociate: { id: 'gid://shopify/Customer/9' },
    })
    expect(graphql.mock.calls[1][0].variables.order.customer).toBeUndefined()
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

describe('isInvalidPhoneUserError', () => {
  it('matches Shopify phone validation copy', () => {
    expect(isInvalidPhoneUserError('Phone is invalid')).toBe(true)
    expect(isInvalidPhoneUserError('variant not found')).toBe(false)
  })
})
