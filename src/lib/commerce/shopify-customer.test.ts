import { beforeEach, describe, expect, it, vi } from 'vitest'

const graphql = vi.fn()

vi.mock('@/lib/shopify/client', () => ({
  shopifyGraphql: (...args: unknown[]) => graphql(...args),
}))

import { mailingAddressFromBeneficiary, upsertShopifyCustomerForPayment } from './shopify-customer'
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

const beneficiary = {
  name: 'Ada Lovelace',
  address_line1: '12 MG',
  city: 'Bengaluru',
  state: 'KA',
  country: 'India',
  postal_code: '560001',
  email: 'ada@example.com',
}

describe('mailingAddressFromBeneficiary', () => {
  it('maps the WhatsApp address to Shopify mailing fields', () => {
    expect(
      mailingAddressFromBeneficiary({
        beneficiary,
        phone: '918129760955',
      }),
    ).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      address1: '12 MG',
      city: 'Bengaluru',
      countryCode: 'IN',
      zip: '560001',
      phone: '+918129760955',
    })
  })
})

describe('upsertShopifyCustomerForPayment', () => {
  beforeEach(() => {
    graphql.mockReset()
  })

  it('creates a customer when none exists', async () => {
    graphql.mockImplementation(async (args: { query?: string }) => {
      if (String(args.query).includes('CustomerAddressByQuery')) {
        return { customers: { nodes: [] } }
      }
      return {
        customerCreate: {
          userErrors: [],
          customer: { id: 'gid://shopify/Customer/9' },
        },
      }
    })

    const id = await upsertShopifyCustomerForPayment({
      config,
      phone: '918129760955',
      email: 'ada@example.com',
      beneficiary,
    })
    expect(id).toBe('gid://shopify/Customer/9')
    expect(graphql.mock.calls.at(-1)?.[0].query).toContain('WhatsAppCommerceCustomerCreate')
  })

  it('returns null when customer GraphQL fails so order create can continue', async () => {
    graphql.mockRejectedValue(new Error('boom'))
    await expect(
      upsertShopifyCustomerForPayment({
        config,
        phone: '918129760955',
        beneficiary,
      }),
    ).resolves.toBeNull()
  })
})
