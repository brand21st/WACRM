import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import type { ShopifyStoreConfig } from '@/lib/shopify/types'
import { numericShopifyId } from '@/lib/shopify/retailer-id'
import type { CommerceBeneficiary, MappedCartLine } from './types'
import type { AppliedCommerceDiscount } from './shopify-discount'

export const ORDER_CREATE_MUTATION = `
mutation WhatsAppCommerceOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    userErrors { field message }
    order { id name }
  }
}
`

export const ORDER_MARK_AS_PAID_MUTATION = `
mutation WhatsAppCommerceOrderMarkAsPaid($input: OrderMarkAsPaidInput!) {
  orderMarkAsPaid(input: $input) {
    userErrors { field message }
    order { id name }
  }
}
`

export const WHATSAPP_COMMERCE_TAG = 'whatsapp-commerce'
export const WHATSAPP_PAYMENT_GATEWAY = 'whatsapp'

export interface CreatePaidShopifyOrderArgs {
  config: ShopifyStoreConfig
  referenceId: string
  phone: string | null
  beneficiary: CommerceBeneficiary | null
  lines: MappedCartLine[]
  totalPaise: number
  discount?: AppliedCommerceDiscount | null
  authorizationCode?: string | null
}

export interface CreatedShopifyOrder {
  id: string
  name: string
}

export function variantGid(variantId: string): string {
  const numeric = numericShopifyId(variantId) || variantId.trim()
  if (numeric.startsWith('gid://')) return numeric
  return `gid://shopify/ProductVariant/${numeric}`
}

export function shopifyMoneyFromPaise(paise: number): string {
  return (Math.max(0, Math.round(paise)) / 100).toFixed(2)
}

/**
 * Build the `orderCreate` variables for a WhatsApp-captured payment.
 *
 * Shopify only records a real payment (and fires `orders/paid`) when a SALE
 * transaction exists. Setting `financialStatus: PAID` alone leaves the order
 * looking paid in the badge while outstanding balance and payment events stay
 * empty — so we create PENDING with the captured WhatsApp transaction, then
 * `orderMarkAsPaid` as a second step.
 */
export function paidShopifyOrderCreateVariables(
  args: CreatePaidShopifyOrderArgs,
): { order: Record<string, unknown>; options: Record<string, unknown> } {
  const shipping = args.beneficiary
    ? {
        firstName: firstName(args.beneficiary.name),
        lastName: lastName(args.beneficiary.name),
        address1: args.beneficiary.address_line1,
        address2: args.beneficiary.address_line2 || undefined,
        city: args.beneficiary.city,
        province: args.beneficiary.state,
        countryCode: 'IN' as const,
        zip: args.beneficiary.postal_code,
        phone: args.phone || undefined,
      }
    : undefined

  const amount = shopifyMoneyFromPaise(args.totalPaise)
  const authorizationCode = args.authorizationCode?.trim() || undefined

  return {
    order: {
      currency: 'INR',
      financialStatus: 'PENDING',
      tags: [WHATSAPP_COMMERCE_TAG, args.referenceId],
      note: `WhatsApp commerce ${args.referenceId}`,
      phone: args.phone || undefined,
      lineItems: args.lines.map((line) => ({
        variantId: variantGid(line.variantId),
        quantity: line.quantity,
      })),
      shippingAddress: shipping,
      discountCode: orderCreateDiscountInput(args.discount),
      transactions: [
        {
          kind: 'SALE',
          status: 'SUCCESS',
          gateway: WHATSAPP_PAYMENT_GATEWAY,
          amountSet: {
            shopMoney: {
              amount,
              currencyCode: 'INR',
            },
          },
          ...(authorizationCode ? { authorizationCode } : {}),
        },
      ],
    },
    options: {
      sendReceipt: false,
      inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
    },
  }
}

export async function createPaidShopifyOrder(
  args: CreatePaidShopifyOrderArgs,
): Promise<CreatedShopifyOrder> {
  if (args.lines.length === 0) {
    throw new Error('Cannot create a Shopify order without line items')
  }
  const unmapped = args.lines.filter((line) => !line.variantId)
  if (unmapped.length > 0) {
    throw new Error(
      `Missing Shopify variant for retailer_id ${unmapped[0].retailer_id}`,
    )
  }

  const data = await shopifyGraphql<{
    orderCreate?: {
      userErrors?: { field?: string[] | null; message?: string }[]
      order?: { id?: string; name?: string } | null
    }
  }>({
    shopDomain: args.config.shopDomain,
    accessToken: args.config.accessToken,
    query: ORDER_CREATE_MUTATION,
    variables: paidShopifyOrderCreateVariables(args),
  })

  const payload = data.orderCreate
  const errors = payload?.userErrors?.filter((e) => e.message) ?? []
  if (errors.length > 0) {
    throw new ShopifyError(
      errors.map((e) => e.message).join('; ') || 'Shopify orderCreate failed',
      422,
      'shopify_order_create',
    )
  }
  const id = payload?.order?.id
  const name = payload?.order?.name
  if (!id || !name) {
    throw new ShopifyError('Shopify orderCreate returned no order', 502)
  }

  return { id, name }
}

/**
 * Record the outstanding balance as paid. Safe to call again when the order
 * is already paid — Shopify returns a userError we ignore.
 */
export async function markShopifyOrderAsPaid(args: {
  config: ShopifyStoreConfig
  orderId: string
}): Promise<void> {
  const data = await shopifyGraphql<{
    orderMarkAsPaid?: {
      userErrors?: { field?: string[] | null; message?: string }[]
      order?: { id?: string; name?: string } | null
    }
  }>({
    shopDomain: args.config.shopDomain,
    accessToken: args.config.accessToken,
    query: ORDER_MARK_AS_PAID_MUTATION,
    variables: { input: { id: args.orderId } },
  })

  const errors =
    data.orderMarkAsPaid?.userErrors?.filter((e) => e.message) ?? []
  const blocking = errors.filter((e) => !isAlreadyPaidUserError(e.message))
  if (blocking.length > 0) {
    throw new ShopifyError(
      blocking.map((e) => e.message).join('; ') || 'Shopify orderMarkAsPaid failed',
      422,
      'shopify_order_mark_as_paid',
    )
  }
}

export function isAlreadyPaidUserError(message: string | undefined): boolean {
  const text = (message ?? '').toLowerCase()
  return (
    text.includes('cannot be marked as paid') ||
    text.includes('already paid') ||
    text.includes('already been paid')
  )
}

export function orderCreateDiscountInput(
  discount: AppliedCommerceDiscount | null | undefined,
): Record<string, unknown> | undefined {
  if (!discount || discount.amountPaise <= 0 || !discount.code.trim()) return undefined
  if (discount.kind === 'percentage' && discount.percent != null && discount.percent > 0) {
    return {
      itemPercentageDiscountCode: {
        code: discount.code,
        percentage: discount.percent,
      },
    }
  }
  return {
    itemFixedDiscountCode: {
      code: discount.code,
      amountSet: {
        shopMoney: {
          amount: shopifyMoneyFromPaise(discount.amountPaise),
          currencyCode: 'INR',
        },
      },
    },
  }
}

function firstName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[0] || name
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.slice(1).join(' ') || parts[0] || name
}
