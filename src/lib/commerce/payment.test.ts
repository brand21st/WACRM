import { beforeEach, describe, expect, it, vi } from 'vitest'

const lookup = vi.fn()
const sendStatus = vi.fn()
const createOrder = vi.fn()
const markPaid = vi.fn()
const markWhatsAppPaid = vi.fn()
const engineOrderStatus = vi.fn()
const engineText = vi.fn()

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

vi.mock('@/lib/flows/meta-send', () => ({
  engineSendOrderStatus: (...args: unknown[]) => engineOrderStatus(...args),
  engineSendText: (...args: unknown[]) => engineText(...args),
}))

vi.mock('./shopify-order', () => ({
  createPaidShopifyOrder: (...args: unknown[]) => createOrder(...args),
  markShopifyOrderAsPaid: (...args: unknown[]) => markPaid(...args),
}))

vi.mock('./shopify-customer', () => ({
  upsertShopifyCustomerForPayment: async () => 'gid://shopify/Customer/1',
}))

vi.mock('./checkout', () => ({
  insertInboxNote: vi.fn(),
}))

vi.mock('./paid-labels', () => ({
  markContactWhatsAppPaid: (...args: unknown[]) => markWhatsAppPaid(...args),
}))

import { handleWhatsAppPaymentStatus } from './payment'
import {
  ORDER_CONFIRMED_BODY,
  PAYMENT_RECEIVED_BODY,
  orderConfirmedText,
} from './order-status'

describe('handleWhatsAppPaymentStatus', () => {
  beforeEach(() => {
    lookup.mockReset()
    sendStatus.mockReset()
    createOrder.mockReset()
    markPaid.mockReset()
    markWhatsAppPaid.mockReset()
    markWhatsAppPaid.mockResolvedValue(true)
    engineOrderStatus.mockReset()
    engineText.mockReset()
  })

  it('does not create a Shopify order until lookup status is captured', async () => {
    lookup.mockResolvedValue({
      reference_id: 'wac_1',
      status: 'pending',
      transactions: [{ status: 'failed' }],
    })

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
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
    expect(engineOrderStatus).not.toHaveBeenCalled()
  })

  it('creates the Shopify order, then confirms it in chat with the order number', async () => {
    capturedLookup()
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(createOrder).toHaveBeenCalled()
    expect(markPaid).toHaveBeenCalled()
    expect(markWhatsAppPaid).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      'c-1',
    )
    // Confirmed only after Shopify accepted the order.
    expect(createOrder.mock.invocationCallOrder[0]).toBeLessThan(
      engineOrderStatus.mock.invocationCallOrder[0],
    )
    expect(engineOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'processing',
        referenceId: 'wac_1',
        conversationId: 'conv-1',
        bodyText: ORDER_CONFIRMED_BODY,
      }),
    )
    expect(engineText).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        text: orderConfirmedText('#1001'),
      }),
    )
    // Persisted through the engine senders, not a raw Graph call, so
    // both messages show up in the inbox.
    expect(sendStatus).not.toHaveBeenCalled()
  })

  it('acknowledges the payment but claims no order when Shopify create fails', async () => {
    capturedLookup()
    createOrder.mockRejectedValue(new Error('variant not found'))

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(engineOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ bodyText: PAYMENT_RECEIVED_BODY }),
    )
    expect(engineText).not.toHaveBeenCalled()
  })

  it('falls back to a raw Graph send when the order has no conversation', async () => {
    capturedLookup()
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })

    await handleWhatsAppPaymentStatus({
      db: makeDb({ conversationId: null }) as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(engineOrderStatus).not.toHaveBeenCalled()
    expect(sendStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'processing',
        referenceId: 'wac_1',
        bodyText: ORDER_CONFIRMED_BODY,
      }),
    )
  })

  it('still creates the Shopify order on retry after the ledger moved to processing', async () => {
    capturedLookup()
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })

    await handleWhatsAppPaymentStatus({
      db: makeDb({ status: 'processing' }) as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(createOrder).toHaveBeenCalled()
    expect(engineOrderStatus).not.toHaveBeenCalled()
    expect(engineText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: orderConfirmedText('#1001'),
      }),
    )
  })

  it('marks an existing Shopify order paid instead of creating a duplicate', async () => {
    capturedLookup()
    markPaid.mockResolvedValue(undefined)

    await handleWhatsAppPaymentStatus({
      db: makeDb({
        status: 'processing',
        shopifyOrderId: 'gid://shopify/Order/1',
        shopifyOrderName: '#1001',
      }) as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(createOrder).not.toHaveBeenCalled()
    expect(markPaid).toHaveBeenCalled()
    expect(engineText).not.toHaveBeenCalled()
  })

  it('creates the Shopify order when lookup status is pending but a transaction succeeded', async () => {
    lookup.mockResolvedValue({
      reference_id: 'wac_1',
      status: 'pending',
      transactions: [{ id: 'order_1', pg_transaction_id: 'pay_1', status: 'success' }],
    })
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })
    engineOrderStatus.mockResolvedValue({ whatsapp_message_id: 'wamid.status' })
    engineText.mockResolvedValue({ whatsapp_message_id: 'wamid.text' })

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        recipient_id: '9198',
        payment: { reference_id: 'wac_1' },
      },
    })

    expect(createOrder).toHaveBeenCalled()
  })

  it('creates the Shopify order when lookup throws but the HMAC webhook is captured', async () => {
    lookup.mockRejectedValue(new Error('lookup timeout'))
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })
    engineOrderStatus.mockResolvedValue({ whatsapp_message_id: 'wamid.status' })
    engineText.mockResolvedValue({ whatsapp_message_id: 'wamid.text' })

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        status: 'captured',
        recipient_id: '9198',
        payment: {
          reference_id: 'wac_1',
          transaction: { id: 'order_1', pg_transaction_id: 'pay_1', status: 'success' },
        },
      },
    })

    expect(createOrder).toHaveBeenCalled()
  })

  it('creates the Shopify order when lookup is empty but the HMAC webhook is captured', async () => {
    lookup.mockResolvedValue(null)
    createOrder.mockResolvedValue({ id: 'gid://shopify/Order/1', name: '#1001' })
    engineOrderStatus.mockResolvedValue({ whatsapp_message_id: 'wamid.status' })
    engineText.mockResolvedValue({ whatsapp_message_id: 'wamid.text' })

    await handleWhatsAppPaymentStatus({
      db: makeDb() as never,
      phoneNumberId: 'pnid',
      status: {
        type: 'payment',
        status: 'captured',
        recipient_id: '9198',
        payment: {
          reference_id: 'wac_1',
          transaction: { status: 'success' },
        },
      },
    })

    expect(createOrder).toHaveBeenCalled()
  })
})

function capturedLookup() {
  lookup.mockResolvedValue({
    reference_id: 'wac_1',
    status: 'captured',
    transactions: [{ id: 'order_1', pg_transaction_id: 'pay_1', status: 'success' }],
  })
  sendStatus.mockResolvedValue({ messageId: 'wamid' })
  engineOrderStatus.mockResolvedValue({ whatsapp_message_id: 'wamid.status' })
  engineText.mockResolvedValue({ whatsapp_message_id: 'wamid.text' })
}

function makeDb(
  options: {
    conversationId?: string | null
    status?: string
    shopifyOrderId?: string | null
    shopifyOrderName?: string | null
  } = {},
) {
  const conversationId =
    options.conversationId === undefined ? 'conv-1' : options.conversationId
  const status = options.status ?? 'pending'
  return {
    from: (table: string) => {
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  account_id: 'acct-1',
                  user_id: 'user-1',
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
                    status,
                    conversation_id: conversationId,
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
                    shopify_order_id: options.shopifyOrderId ?? null,
                    shopify_order_name: options.shopifyOrderName ?? null,
                    payment_config_id: 'razorpay_prod',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({ eq: async () => ({ error: null }) }),
          }),
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
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      }
    },
  }
}
