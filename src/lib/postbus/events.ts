export const POSTBUS_LIVE_EVENTS = [
  'order_confirmation',
  'processing',
  'booked',
  'in_transit',
  'delivered',
] as const

/** Placeholder keys from Phase 1 — not sourced by PostBus. */
export const POSTBUS_FUTURE_EVENTS = [
  'order_created',
  'shipment_created',
  'shipment_dispatched',
  'out_for_delivery',
  'delivery_failed',
  'tracking_updated',
  'return_rto',
  'other',
] as const

export const POSTBUS_NOTIFICATION_EVENTS = POSTBUS_LIVE_EVENTS

export type PostBusNotificationEvent =
  (typeof POSTBUS_LIVE_EVENTS)[number]

export const POSTBUS_TEMPLATE_COLUMNS: Record<
  PostBusNotificationEvent,
  | 'order_confirmation_template_name'
  | 'processing_template_name'
  | 'booked_template_name'
  | 'in_transit_template_name'
  | 'delivered_template_name'
> = {
  order_confirmation: 'order_confirmation_template_name',
  processing: 'processing_template_name',
  booked: 'booked_template_name',
  in_transit: 'in_transit_template_name',
  delivered: 'delivered_template_name',
}
