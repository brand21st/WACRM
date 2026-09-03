import { assertAmountIdentity, inrAmount, isValidReferenceId } from './money'
import type { CommerceBeneficiary } from './types'

export interface OrderDetailsItem {
  retailer_id: string
  name: string
  quantity: number
  amountPaise: number
  saleAmountPaise?: number
}

export interface BuildOrderDetailsArgs {
  referenceId: string
  catalogId: string
  configurationName: string
  accountId: string
  bodyText: string
  footerText?: string
  headerImageUrl?: string
  items: OrderDetailsItem[]
  taxPaise?: number
  shippingPaise?: number
  discountPaise?: number
  beneficiary: CommerceBeneficiary
  expirationSeconds?: number
}

const NAME_MAX = 60
const BODY_MAX = 1024
const FOOTER_MAX = 60
const CONFIG_NAME_MAX = 60

export function buildOrderDetailsInteractive(args: BuildOrderDetailsArgs): {
  type: 'interactive'
  interactive: Record<string, unknown>
} {
  if (!isValidReferenceId(args.referenceId)) {
    throw new Error('reference_id must be 1–35 chars [A-Za-z0-9._-]')
  }
  const configurationName = args.configurationName.trim()
  if (!configurationName || configurationName.length > CONFIG_NAME_MAX) {
    throw new Error('payment configuration_name is required (max 60 chars)')
  }
  const catalogId = args.catalogId.trim()
  if (!catalogId) throw new Error('catalog_id is required for catalog-based bills')
  if (!args.items.length) throw new Error('order_details needs at least one item')

  const subtotal = args.items.reduce((sum, item) => {
    const unit =
      item.saleAmountPaise != null && item.saleAmountPaise < item.amountPaise
        ? item.saleAmountPaise
        : item.amountPaise
    return sum + unit * item.quantity
  }, 0)
  const tax = Math.max(0, Math.round(args.taxPaise ?? 0))
  const shipping = Math.max(0, Math.round(args.shippingPaise ?? 0))
  const discount = Math.max(0, Math.round(args.discountPaise ?? 0))
  const total = subtotal + tax + shipping - discount
  assertAmountIdentity({ subtotal, tax, shipping, discount, total })

  const beneficiary = sanitizeBeneficiary(args.beneficiary)
  const parameters: Record<string, unknown> = {
    reference_id: args.referenceId,
    type: 'physical-goods',
    beneficiaries: [beneficiary],
    currency: 'INR',
    total_amount: inrAmount(total),
    payment_settings: [
      {
        type: 'payment_gateway',
        payment_gateway: {
          type: 'razorpay',
          configuration_name: configurationName,
          razorpay: {
            receipt: args.referenceId.slice(0, 40),
            notes: { account_id: args.accountId },
          },
        },
      },
    ],
    order: {
      status: 'pending',
      catalog_id: catalogId,
      items: args.items.map((item) => {
        const row: Record<string, unknown> = {
          retailer_id: item.retailer_id,
          name: item.name.trim().slice(0, NAME_MAX),
          amount: inrAmount(item.amountPaise),
          quantity: Math.max(1, Math.floor(item.quantity)),
        }
        if (
          item.saleAmountPaise != null &&
          item.saleAmountPaise < item.amountPaise
        ) {
          row.sale_amount = inrAmount(item.saleAmountPaise)
        }
        return row
      }),
      subtotal: inrAmount(subtotal),
      tax: inrAmount(tax),
    },
  }

  const order = parameters.order as Record<string, unknown>
  if (shipping > 0) order.shipping = inrAmount(shipping)
  if (discount > 0) order.discount = inrAmount(discount)
  if (args.expirationSeconds && args.expirationSeconds >= 300) {
    order.expiration = {
      timestamp: String(Math.floor(Date.now() / 1000) + args.expirationSeconds),
      description: 'Pay before this bill expires',
    }
  }

  const interactive: Record<string, unknown> = {
    type: 'order_details',
    body: { text: args.bodyText.trim().slice(0, BODY_MAX) || 'Review and pay' },
    action: {
      name: 'review_and_pay',
      parameters: JSON.stringify(parameters),
    },
  }
  if (args.headerImageUrl?.trim()) {
    interactive.header = {
      type: 'image',
      image: { link: args.headerImageUrl.trim() },
    }
  }
  if (args.footerText?.trim()) {
    interactive.footer = { text: args.footerText.trim().slice(0, FOOTER_MAX) }
  }

  return { type: 'interactive', interactive }
}

export function parseOrderDetailsParameters(
  raw: unknown,
): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return null
    }
    return null
  }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return null
}

export function sanitizeBeneficiary(
  input: CommerceBeneficiary,
): CommerceBeneficiary {
  const postal = String(input.postal_code ?? '').replace(/\D/g, '').slice(0, 6)
  const name = input.name.trim().slice(0, 200)
  const address_line1 = input.address_line1.trim().slice(0, 100)
  const city = input.city.trim()
  const state = input.state.trim()
  if (!name || !address_line1 || !city || !state || postal.length !== 6) {
    throw new Error(
      'Shipping address needs name, address, city, state, and a 6-digit PIN',
    )
  }
  return {
    name,
    address_line1,
    address_line2: input.address_line2?.trim().slice(0, 100) || undefined,
    city,
    state,
    country: 'India',
    postal_code: postal,
  }
}

export function isCompleteBeneficiary(
  value: unknown,
): value is CommerceBeneficiary {
  if (!value || typeof value !== 'object') return false
  try {
    sanitizeBeneficiary(value as CommerceBeneficiary)
    return true
  } catch {
    return false
  }
}
