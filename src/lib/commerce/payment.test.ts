import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.fn()
const sendStatus = vi.fn()
const createOrder = vi.fn()

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => v,
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  lookupWhatsAppPayment: (...args: unknown[]) => lookup(...args),
  sendOrderStatusMessage: (...args: unknown[]) => sendStatus(...args),
}))

vi.mock('@/lib/shopify/commerce-config', () => ({
  loadCommerceSettings: async () => ({
    waPaymentConfigurationName: 'razorpay_prod',
    metaCatalogId: '111',
  }),
}))

vi.mock('@/lib/shopify/config', () => ({
  loadShopifyConfig: async () => ({
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
  }),
}))

vi.mock('./shopify-order', () => ({
  createPaidShopifyOrder: (...args: unknown[]) => createOrder(...args),
}))

vi.mock('./checkout', () => ({
  insertInboxNote: vi.fn(),
}))

import { handleWhatsAppPaymentStatus } from './payment'

describe('handleWhatsAppPaymentStatus', () => {
  beforeEach(() => {
    lookup.mockReset()
    sendStatus.mockReset()
    createOrder.mockReset()
  })

  it('does not create a Shopify order until lookup status is captured', async () => {
    lookup.mockResolvedValue({
      reference_id: 'wac_1',
      status: 'pending',
      transactions: [{ status: 'failed' }],
    })
    const updates: unknown[] = []
    const db = {
      from: (table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    account_id: 'acct-1',
                    access_token: 'token',
                    phone_number_id: 'pnid',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'whatsapp_commerce_orders') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'ord-1',
                      status: 'pending',
                      conversation_id: 'conv-1',
                      contact_id: 'c-1',
                      line_items: [
                        {
                          retailer_id: 'BAG-RED',
                          variantId: '99',
                          quantity: 1,
                          amountPaise: 4900,
                          name: 'Red Bag',
                          productId: '42',
                          sku: 'BAG-RED',
                        },
                      ],
                      beneficiary: {
                        name: 'Ada',
                        address_line1: '12 MG',
                        city: 'Bengaluru',
                        state: 'KA',
                        country: 'India',
                        postal_code: '560001',
                      },
                      total_value: 4900,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: (payload: unknown) => {
              updates.push(payload)
              return { eq: () => ({ eq: async () => ({ error: null }) }) }
            },
          }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
      },
    }

    await handleWhatsAppPaymentStatus({
      db: db as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(lookup).toHaveBeenCalled()
    expect(createOrder).not.toHaveBeenCalled()
    expect(sendStatus).not.toHaveBeenCalled()
  })

  it('creates a Shopify order after lookup captured', async () => {
    lookup.mockResolvedValue({
      reference_id: 'wac_1',
      status: 'captured',
      transactions: [{ id: 'order_1', pg_transaction_id: 'pay_1', status: 'success' }],
    })
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })
    sendStatus.mockResolvedValue({ messageId: 'wamid' })

    const db = {
      from: (table: string) => {
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    account_id: 'acct-1',
                    access_token: 'token',
                    phone_number_id: 'pnid',
                  },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'whatsapp_commerce_orders') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'ord-1',
                      status: 'pending',
                      conversation_id: 'conv-1',
                      contact_id: 'c-1',
                      line_items: [
                        {
                          retailer_id: 'BAG-RED',
                          variantId: '99',
                          quantity: 1,
                          amountPaise: 4900,
                          name: 'Red Bag',
                          productId: '42',
                          sku: 'BAG-RED',
                        },
                      ],
                      beneficiary: {
                        name: 'Ada',
                        address_line1: '12 MG',
                        city: 'Bengaluru',
                        state: 'KA',
                        country: 'India',
                        postal_code: '560001',
                      },
                      total_value: 4900,
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({ eq: () => ({ eq: async () => ({ error: null }) }) }),
          }
        }
        if (table === 'contacts') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { phone: '9198' }, error: null }),
              }),
            }),
          }
        }
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }
      },
    }

    await handleWhatsAppPaymentStatus({
      db: db as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(createOrder).toHaveBeenCalled()
    expect(sendStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'processing', referenceId: 'wac_1' }),
    )
  })
})
