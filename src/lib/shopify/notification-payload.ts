import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import type { ShopifyNotificationTrigger } from './notification-triggers'

export interface NotificationAction {
  kind: 'send' | 'queue' | 'cancel_abandoned'
  trigger: ShopifyNotificationTrigger
  resourceId: string
  fields: Record<string, string>
  delayMs?: number
  /** Checkout / order tokens used to cancel an abandoned-checkout job. */
  cancelIds?: string[]
}

export interface NotificationRuleHints {
  delayHours: number
  daysAfter: number
  discountCode: string
}

const EMPTY_HINTS: NotificationRuleHints = {
  delayHours: 1,
  daysAfter: 3,
  discountCode: '',
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

function str(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function nested(body: Record<string, unknown>, path: string[]): unknown {
  let cur: unknown = body
  for (const key of path) {
    const rec = asRecord(cur)
    if (!rec) return undefined
    cur = rec[key]
  }
  return cur
}

const PRODUCT_DETAILS_MAX = 500

/** Path + query for a Meta URL-button suffix (`https://shop.com/{{1}}`). */
export function urlPartial(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    return `${parsed.pathname.replace(/^\//, '')}${parsed.search}`
  } catch {
    return trimmed.replace(/^https?:\/\/[^/]+\/?/i, '')
  }
}

export function withUrlPartials(
  fields: Record<string, string>,
): Record<string, string> {
  const checkout = fields.checkout_url || fields.abandoned_checkout_url || ''
  const tracking = fields.tracking_url || ''
  const status = fields.order_status_url || ''
  return {
    ...fields,
    checkout_url: fields.checkout_url || checkout,
    abandoned_checkout_url: fields.abandoned_checkout_url || checkout,
    checkout_url_partial: urlPartial(checkout),
    tracking_url_partial: urlPartial(tracking),
    order_status_url_partial: urlPartial(status),
  }
}

export function attachShopContext(
  fields: Record<string, string>,
  shop: { shopName?: string | null; currency?: string | null },
): Record<string, string> {
  return withUrlPartials({
    ...fields,
    shop_name: fields.shop_name?.trim() || shop.shopName?.trim() || '',
    currency: fields.currency?.trim() || shop.currency?.trim() || '',
  })
}

export function appendDiscountToCheckoutUrl(
  url: string,
  code: string,
): string {
  const trimmed = url.trim()
  const coupon = code.trim()
  if (!trimmed) return ''
  if (!coupon) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (!parsed.searchParams.get('discount')) {
      parsed.searchParams.set('discount', coupon)
    }
    return parsed.toString()
  } catch {
    if (/[?&]discount=/i.test(trimmed)) return trimmed
    const sep = trimmed.includes('?') ? '&' : '?'
    return `${trimmed}${sep}discount=${encodeURIComponent(coupon)}`
  }
}

function collectPhoneCandidates(body: Record<string, unknown>): string[] {
  const out: string[] = []
  const push = (raw: unknown) => {
    const value = str(raw)
    if (value) out.push(value)
  }
  push(body.phone)
  push(nested(body, ['customer', 'phone']))
  push(nested(body, ['shipping_address', 'phone']))
  push(nested(body, ['billing_address', 'phone']))
  push(nested(body, ['default_address', 'phone']))
  push(nested(body, ['destination', 'phone']))
  const addresses = body.shipping_address
  if (Array.isArray(body.addresses)) {
    for (const row of body.addresses) {
      push(asRecord(row)?.phone)
    }
  }
  void addresses
  return out
}

export function firstValidShopifyPhone(
  body: Record<string, unknown>,
): string | null {
  for (const raw of collectPhoneCandidates(body)) {
    const digits = sanitizePhoneForMeta(raw)
    if (isValidE164(digits) || isValidE164(`+${digits}`)) return raw
  }
  return collectPhoneCandidates(body)[0] ?? null
}

function customerName(body: Record<string, unknown>): {
  first: string
  last: string
  full: string
} {
  const first =
    str(nested(body, ['customer', 'first_name'])) ||
    str(nested(body, ['shipping_address', 'first_name'])) ||
    str(nested(body, ['billing_address', 'first_name']))
  const last =
    str(nested(body, ['customer', 'last_name'])) ||
    str(nested(body, ['shipping_address', 'last_name'])) ||
    str(nested(body, ['billing_address', 'last_name']))
  const full =
    str(nested(body, ['customer', 'name'])) ||
    [first, last].filter(Boolean).join(' ').trim() ||
    str(body.email)
  return { first: first || full.split(/\s+/)[0] || '', last, full }
}

function productDetails(body: Record<string, unknown>): string {
  const items = Array.isArray(body.line_items) ? body.line_items : []
  const parts: string[] = []
  for (const raw of items) {
    const rec = asRecord(raw)
    if (!rec) continue
    const title = str(rec.title)
    if (!title) continue
    const qty = str(rec.quantity) || '1'
    const variant = str(rec.variant_title)
    parts.push(variant ? `${qty}× ${title} (${variant})` : `${qty}× ${title}`)
  }
  const joined = parts.join(', ')
  if (joined.length <= PRODUCT_DETAILS_MAX) return joined
  return `${joined.slice(0, PRODUCT_DETAILS_MAX - 1).trimEnd()}…`
}

function customerAddress(body: Record<string, unknown>): string {
  const addr =
    asRecord(body.shipping_address) ||
    asRecord(nested(body, ['customer', 'default_address'])) ||
    asRecord(body.billing_address)
  if (!addr) return ''
  return [
    str(addr.address1),
    str(addr.address2),
    str(addr.city),
    str(addr.province),
    str(addr.zip),
    str(addr.country),
  ]
    .filter(Boolean)
    .join(', ')
}

function money(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(body[key])
    if (value) return value
  }
  return ''
}

function orderName(body: Record<string, unknown>): string {
  return str(body.name) || str(body.order_name) || str(body.order_number)
}

function resourceId(body: Record<string, unknown>, fallbackKeys: string[]): string {
  for (const key of fallbackKeys) {
    const value = str(body[key])
    if (value) return value
  }
  const id = body.id
  if (typeof id === 'number' && Number.isFinite(id)) return String(id)
  return str(id)
}

function isOrderFulfilled(body: Record<string, unknown>): boolean {
  return str(body.fulfillment_status).toLowerCase() === 'fulfilled'
}

function isCheckoutCompleted(body: Record<string, unknown>): boolean {
  return Boolean(str(body.completed_at))
}

function trackingFrom(body: Record<string, unknown>): {
  number: string
  url: string
  company: string
} {
  const numbers = body.tracking_numbers
  const urls = body.tracking_urls
  const number =
    str(body.tracking_number) ||
    (Array.isArray(numbers) ? str(numbers[0]) : '')
  const url =
    str(body.tracking_url) || (Array.isArray(urls) ? str(urls[0]) : '')
  return {
    number,
    url,
    company: str(body.tracking_company),
  }
}

function payloadExtras(body: Record<string, unknown>): Record<string, string> {
  const names = customerName(body)
  return {
    customer_last_name: names.last,
    order_number: str(body.order_number),
    order_status_url: str(body.order_status_url),
    product_details: productDetails(body),
    customer_address: customerAddress(body),
    shop_name: '',
    abandoned_checkout_url: '',
    checkout_url_partial: '',
    tracking_url_partial: '',
    order_status_url_partial: '',
  }
}

export function orderFields(
  body: Record<string, unknown>,
  extra: Record<string, string> = {},
): Record<string, string> {
  const names = customerName(body)
  return withUrlPartials({
    customer_first_name: names.first,
    customer_name: names.full,
    order_name: orderName(body),
    total: money(body, ['current_total_price', 'total_price', 'total_price_set']),
    currency: str(body.currency) || str(nested(body, ['total_price_set', 'shop_money', 'currency_code'])),
    checkout_url: '',
    discount_code: '',
    tracking_number: '',
    tracking_url: '',
    tracking_company: '',
    refund_amount: '',
    phone: firstValidShopifyPhone(body) ?? '',
    email: str(body.email) || str(nested(body, ['customer', 'email'])),
    ...payloadExtras(body),
    ...extra,
  })
}

export function checkoutFields(
  body: Record<string, unknown>,
  discountCode: string,
): Record<string, string> {
  const names = customerName(body)
  const rawUrl = str(body.abandoned_checkout_url)
  const checkoutUrl = appendDiscountToCheckoutUrl(rawUrl, discountCode)
  return withUrlPartials({
    customer_first_name: names.first,
    customer_name: names.full,
    order_name: '',
    total: money(body, ['total_price', 'subtotal_price']),
    currency: str(body.currency),
    checkout_url: checkoutUrl,
    discount_code: discountCode.trim(),
    tracking_number: '',
    tracking_url: '',
    tracking_company: '',
    refund_amount: '',
    phone: firstValidShopifyPhone(body) ?? '',
    email: str(body.email) || str(nested(body, ['customer', 'email'])),
    ...payloadExtras(body),
    abandoned_checkout_url: checkoutUrl,
  })
}

export function fulfillmentFields(
  body: Record<string, unknown>,
): Record<string, string> {
  const tracking = trackingFrom(body)
  const names = customerName(body)
  return withUrlPartials({
    customer_first_name: names.first,
    customer_name: names.full,
    order_name: orderName(body) || str(body.order_id),
    total: '',
    currency: '',
    checkout_url: '',
    discount_code: '',
    tracking_number: tracking.number,
    tracking_url: tracking.url,
    tracking_company: tracking.company,
    refund_amount: '',
    phone: firstValidShopifyPhone(body) ?? '',
    email: str(body.email),
    order_id: str(body.order_id),
    ...payloadExtras(body),
  })
}

export function refundFields(body: Record<string, unknown>): Record<string, string> {
  const txns = Array.isArray(body.transactions) ? body.transactions : []
  let amount = str(body.amount)
  if (!amount) {
    let sum = 0
    for (const row of txns) {
      const rec = asRecord(row)
      const n = Number(str(rec?.amount))
      if (Number.isFinite(n)) sum += n
    }
    if (sum) amount = String(sum)
  }
  return orderFields(body, {
    refund_amount: amount,
    order_name: orderName(body) || str(body.order_id),
    order_id: str(body.order_id),
  })
}

export function returnFields(body: Record<string, unknown>): Record<string, string> {
  const order = asRecord(body.order) ?? body
  return orderFields(order, {
    order_name: orderName(order) || orderName(body),
    order_id: str(body.order_id) || str(nested(body, ['order', 'id'])),
  })
}

export function abandonedCancelIds(body: Record<string, unknown>): string[] {
  const ids = [
    str(body.checkout_token),
    str(body.cart_token),
    str(body.token),
    str(body.checkout_id),
    resourceId(body, ['token', 'id']),
  ].filter(Boolean)
  return [...new Set(ids)]
}

export function fulfillmentEventStatus(body: Record<string, unknown>): string {
  return str(body.status).toLowerCase()
}

export function notificationActionsForTopic(
  topic: string,
  body: Record<string, unknown>,
  hints: NotificationRuleHints = EMPTY_HINTS,
): NotificationAction[] {
  const delayHours = hints.delayHours > 0 ? hints.delayHours : 1
  const daysAfter = hints.daysAfter > 0 ? hints.daysAfter : 3
  const discount = hints.discountCode.trim()

  switch (topic) {
    case 'orders/create': {
      const fields = orderFields(body)
      return [
        {
          kind: 'cancel_abandoned',
          trigger: 'checkout_abandoned',
          resourceId: abandonedCancelIds(body)[0] || resourceId(body, ['id']),
          fields,
          cancelIds: abandonedCancelIds(body),
        },
        {
          kind: 'send',
          trigger: 'new_order',
          resourceId: `order:${resourceId(body, ['id'])}`,
          fields,
        },
      ]
    }
    case 'orders/paid': {
      if (isOrderFulfilled(body)) return []
      return [
        {
          kind: 'send',
          trigger: 'processing',
          resourceId: `order-paid:${resourceId(body, ['id'])}`,
          fields: orderFields(body),
        },
      ]
    }
    case 'checkouts/create':
    case 'checkouts/update': {
      const token = resourceId(body, ['token', 'id'])
      const fields = checkoutFields(body, discount)
      if (isCheckoutCompleted(body)) {
        return [
          {
            kind: 'cancel_abandoned',
            trigger: 'checkout_abandoned',
            resourceId: token,
            fields,
            cancelIds: abandonedCancelIds(body),
          },
        ]
      }
      if (!fields.phone) return []
      return [
        {
          kind: 'queue',
          trigger: 'checkout_abandoned',
          resourceId: token,
          fields,
          delayMs: delayHours * 60 * 60 * 1000,
        },
      ]
    }
    case 'fulfillments/create': {
      const fields = fulfillmentFields(body)
      return [
        {
          kind: 'send',
          trigger: 'fulfilled',
          resourceId: `fulfillment:${resourceId(body, ['id'])}`,
          fields,
        },
      ]
    }
    case 'fulfillments/update': {
      const fields = fulfillmentFields(body)
      if (!fields.tracking_number && !fields.tracking_url) return []
      return [
        {
          kind: 'send',
          trigger: 'tracking',
          resourceId: `tracking:${resourceId(body, ['id'])}`,
          fields,
        },
      ]
    }
    case 'fulfillment_events/create': {
      if (fulfillmentEventStatus(body) !== 'delivered') return []
      const fields = fulfillmentFields(body)
      const deliveredId = resourceId(body, ['fulfillment_id', 'id'])
      return [
        {
          kind: 'send',
          trigger: 'delivered',
          resourceId: `delivered:${deliveredId}`,
          fields,
        },
        {
          kind: 'queue',
          trigger: 'after_delivered',
          resourceId: `after-delivered:${deliveredId}`,
          fields,
          delayMs: daysAfter * 24 * 60 * 60 * 1000,
        },
      ]
    }
    case 'refunds/create': {
      return [
        {
          kind: 'send',
          trigger: 'refund',
          resourceId: `refund:${resourceId(body, ['id'])}`,
          fields: refundFields(body),
        },
      ]
    }
    case 'returns/request': {
      return [
        {
          kind: 'send',
          trigger: 'return_request',
          resourceId: `return:${resourceId(body, ['id'])}`,
          fields: returnFields(body),
        },
      ]
    }
    default:
      return []
  }
}
