import type { CommerceOrderStatus } from './types'
import type { WhatsAppOrderStatus } from '@/lib/whatsapp/meta-api'

const ALLOWED: Record<CommerceOrderStatus, CommerceOrderStatus[]> = {
  pending: ['processing', 'canceled'],
  processing: ['partially_shipped', 'shipped', 'completed'],
  partially_shipped: ['shipped', 'completed'],
  shipped: ['completed'],
  completed: [],
  canceled: [],
}

export function canTransitionOrderStatus(
  from: CommerceOrderStatus,
  to: CommerceOrderStatus,
): boolean {
  if (from === to) return true
  return ALLOWED[from]?.includes(to) === true
}

/** Meta 2047: cannot cancel after the customer has paid. */
export function isCancelAfterPay(
  from: CommerceOrderStatus,
  to: CommerceOrderStatus,
): boolean {
  return to === 'canceled' && from !== 'pending'
}

export function toWhatsAppOrderStatus(
  status: CommerceOrderStatus,
): WhatsAppOrderStatus | null {
  if (status === 'pending') return null
  return status
}

/**
 * Body on the `order_status` card the customer sees once Razorpay has
 * captured. Meta's first post-payment status is `processing`, so the
 * word "confirmed" carries the meaning the customer is looking for.
 */
export const ORDER_CONFIRMED_BODY = 'Order confirmed. Thank you for your payment.'

/**
 * Sent when the paid Shopify order could not be created. The money is
 * ours either way, so the customer still gets an acknowledgement — an
 * agent picks the order up from the inbox note.
 */
export const PAYMENT_RECEIVED_BODY =
  'Payment received. We are processing your order.'

/** Follow-up text carrying the Shopify order number the customer can quote. */
export function orderConfirmedText(shopifyOrderName: string): string {
  const name = shopifyOrderName.trim()
  return name
    ? `Order ${name} is confirmed. We will update you when it ships.`
    : 'Your order is confirmed. We will update you when it ships.'
}

export function shopifyFulfillmentToStatus(
  fulfillmentStatus: string | null | undefined,
  shipmentStatus?: string | null,
): CommerceOrderStatus | null {
  const ship = (shipmentStatus ?? '').toLowerCase()
  if (ship === 'delivered') return 'completed'
  const value = (fulfillmentStatus ?? '').toLowerCase()
  if (value === 'fulfilled' || value === 'success' || value === 'shipped') {
    return 'shipped'
  }
  if (value === 'partial') return 'partially_shipped'
  return null
}
