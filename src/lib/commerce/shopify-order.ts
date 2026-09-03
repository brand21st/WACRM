import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import type { ShopifyStoreConfig } from '@/lib/shopify/types'
import { numericShopifyId } from '@/lib/shopify/retailer-id'
import type { CommerceBeneficiary, MappedCartLine } from './types'

export const ORDER_CREATE_MUTATION = `
mutation WhatsAppCommerceOrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
  orderCreate(order: $order, options: $options) {
    userErrors { field message }
    order { id name }
  }
}
`

export const WHATSAPP_COMMERCE_TAG = 'whatsapp-commerce'

export interface CreatePaidShopifyOrderArgs {
  config: ShopifyStoreConfig
  referenceId: string
  phone: string | null
  beneficiary: CommerceBeneficiary | null
  lines: MappedCartLine[]
  totalPaise: number
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

  const data = await shopifyGraphql<{
    orderCreate?: {
      userErrors?: { field?: string[] | null; message?: string }[]
      order?: { id?: string; name?: string } | null
    }
  }>({
    shopDomain: args.config.shopDomain,
    accessToken: args.config.accessToken,
    query: ORDER_CREATE_MUTATION,
    variables: {
      order: {
        currency: 'INR',
        financialStatus: 'PAID',
        tags: [WHATSAPP_COMMERCE_TAG, args.referenceId],
        note: `WhatsApp commerce ${args.referenceId}`,
        phone: args.phone || undefined,
        lineItems: args.lines.map((line) => ({
          variantId: variantGid(line.variantId),
          quantity: line.quantity,
        })),
        shippingAddress: shipping,
      },
      options: {
        sendReceipt: false,
        inventoryBehaviour: 'DECREMENT_OBEYING_POLICY',
      },
    },
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

function firstName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[0] || name
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.slice(1).join(' ') || parts[0] || name
}
