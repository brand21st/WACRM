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
