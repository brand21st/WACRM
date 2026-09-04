/** Topics that keep the local catalog snapshot in sync with Shopify. */
export const SHOPIFY_CATALOG_WEBHOOK_TOPICS = [
  'products/create',
  'products/update',
  'products/delete',
] as const

/** Topics that keep Online Store pages in sync. Policies refresh on bootstrap. */
export const SHOPIFY_PAGE_WEBHOOK_TOPICS = [
  'pages/create',
  'pages/update',
  'pages/delete',
] as const

/** Order-lifecycle topics that drive WhatsApp template notifications. */
export const SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS = [
  'orders/create',
  'orders/paid',
  'orders/cancelled',
  'orders/partially_fulfilled',
  'checkouts/create',
  'checkouts/update',
  'fulfillments/create',
  'fulfillments/update',
  'fulfillment_events/create',
  'refunds/create',
  'returns/request',
] as const

export const SHOPIFY_WEBHOOK_TOPICS = [
  ...SHOPIFY_CATALOG_WEBHOOK_TOPICS,
  ...SHOPIFY_PAGE_WEBHOOK_TOPICS,
  ...SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS,
] as const

export function isShopifyNotificationTopic(topic: string): boolean {
  return (SHOPIFY_NOTIFICATION_WEBHOOK_TOPICS as readonly string[]).includes(
    topic,
  )
}
