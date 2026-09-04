import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import { toShopifyPhone } from '@/lib/shopify/phone'
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
export const WHATSAPP_COMMERCE_DISPLAY_TAG = 'WhatsApp Commerce'
export const VACHAT_ORDER_TAG = 'VaChat Order'
export const WHATSAPP_PAYMENT_GATEWAY = 'whatsapp'
export const STANDARD_DELIVERY_TITLE = 'Standard Delivery'

export interface CreatePaidShopifyOrderArgs {
  config: ShopifyStoreConfig
  referenceId: string
  phone: string | null
  beneficiary: CommerceBeneficiary | null
  lines: MappedCartLine[]
  totalPaise: number
  discount?: AppliedCommerceDiscount | null
  authorizationCode?: string | null
  customerId?: string | null
  email?: string | null
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
  const phone = toShopifyPhone(args.phone)
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
        phone,
      }
    : undefined

  const amount = shopifyMoneyFromPaise(args.totalPaise)
  const authorizationCode = args.authorizationCode?.trim() || undefined
  const email = args.email?.trim() || args.beneficiary?.email?.trim() || undefined
  const customerId = args.customerId?.trim() || undefined

  return {
    order: {
      currency: 'INR',
      financialStatus: 'PENDING',
      tags: [
        WHATSAPP_COMMERCE_TAG,
        WHATSAPP_COMMERCE_DISPLAY_TAG,
        VACHAT_ORDER_TAG,
        args.referenceId,
      ],
      note: `WhatsApp commerce ${args.referenceId}`,
      phone,
      ...(email ? { email } : {}),
      ...(customerId
        ? { customer: { toAssociate: { id: customerId } } }
        : {}),
      lineItems: args.lines.map((line) => ({
        variantId: variantGid(line.variantId),
        quantity: line.quantity,
      })),
      shippingAddress: shipping,
      billingAddress: shipping,
      shippingLines: [
        {
          title: STANDARD_DELIVERY_TITLE,
          code: 'standard',
          priceSet: {
            shopMoney: {
              amount: '0.00',
              currencyCode: 'INR',
            },
          },
        },
      ],
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
      sendReceipt: Boolean(email),
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

  let variables = paidShopifyOrderCreateVariables(args)
  let payload = await orderCreateWithCustomerFallback(args.config, variables)
  let errors = payload?.userErrors?.filter((e) => e.message) ?? []

  // Payment is already captured. A bad WhatsApp phone or customer link
  // must not block the Shopify order — drop those fields and retry once.
  if (
    errors.some((e) => isInvalidPhoneUserError(e.message)) &&
    orderCreateHasPhone(variables.order)
  ) {
    variables = withoutPhones(variables)
    payload = await orderCreateWithCustomerFallback(args.config, variables)
    errors = payload?.userErrors?.filter((e) => e.message) ?? []
  }
  if (
    errors.some((e) => isInvalidCustomerUserError(e.message)) &&
    variables.order.customer
  ) {
    variables = withoutCustomer(variables)
    payload = await orderCreateOnce(args.config, variables)
    errors = payload?.userErrors?.filter((e) => e.message) ?? []
  }

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

async function orderCreateOnce(
  config: ShopifyStoreConfig,
  variables: { order: Record<string, unknown>; options: Record<string, unknown> },
) {
  const data = await shopifyGraphql<{
    orderCreate?: {
      userErrors?: { field?: string[] | null; message?: string }[]
      order?: { id?: string; name?: string } | null
    }
  }>({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    query: ORDER_CREATE_MUTATION,
    variables,
  })
  return data.orderCreate
}

async function orderCreateWithCustomerFallback(
  config: ShopifyStoreConfig,
  variables: { order: Record<string, unknown>; options: Record<string, unknown> },
) {
  try {
    return await orderCreateOnce(config, variables)
  } catch (err) {
    if (!isInvalidCustomerGraphqlError(err) || !variables.order.customer) {
      throw err
    }
    return orderCreateOnce(config, withoutCustomer(variables))
  }
}

export function withoutCustomer(variables: {
  order: Record<string, unknown>
  options: Record<string, unknown>
}): { order: Record<string, unknown>; options: Record<string, unknown> } {
  const { customer: _customer, ...order } = variables.order
  void _customer
  return { options: variables.options, order }
}

export function isInvalidCustomerGraphqlError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /customer\.(toSet|toAssociate|toUpsert)|Field is not defined on OrderCreateCustomerInput/i.test(
    message,
  )
}

export function isInvalidPhoneUserError(message: string | undefined): boolean {
  return /phone is invalid/i.test(message ?? '')
}

export function isInvalidCustomerUserError(message: string | undefined): boolean {
  return /customer/i.test(message ?? '') && /invalid|not found|does not exist/i.test(message ?? '')
}

export function orderCreateHasPhone(order: Record<string, unknown>): boolean {
  if (typeof order.phone === 'string' && order.phone.trim()) return true
  const shipping = order.shippingAddress as Record<string, unknown> | undefined
  return typeof shipping?.phone === 'string' && Boolean(shipping.phone.trim())
}

export function withoutPhones(variables: {
  order: Record<string, unknown>
  options: Record<string, unknown>
}): { order: Record<string, unknown>; options: Record<string, unknown> } {
  const order = omitPhoneField(variables.order)
  const shipping = order.shippingAddress as Record<string, unknown> | undefined
  if (shipping) {
    order.shippingAddress = omitPhoneField(shipping)
  }
  return { options: variables.options, order }
}

function omitPhoneField(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record }
  delete next.phone
  return next
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
