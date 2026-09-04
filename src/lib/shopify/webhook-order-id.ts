function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function numericFromOrderGid(value: string): string {
  const match = /gid:\/\/shopify\/Order\/(\d+)/i.exec(value.trim())
  return match?.[1] ?? ''
}

function numericId(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(Math.trunc(value))
  if (typeof value !== 'string') return ''
  const fromGid = numericFromOrderGid(value)
  if (fromGid) return fromGid
  const digits = value.trim()
  if (/^\d+$/.test(digits)) return digits
  return ''
}

/**
 * Numeric Shopify Order id from a webhook body. Fulfillment, refund, and
 * event payloads put their own id on `body.id` — never treat that as an
 * Order id.
 */
export function shopifyWebhookOrderNumericId(
  body: Record<string, unknown>,
): string {
  const topGid =
    typeof body.admin_graphql_api_id === 'string' ? body.admin_graphql_api_id : ''
  if (topGid.includes('/Order/')) {
    return numericFromOrderGid(topGid)
  }

  const nested = asRecord(body.order)
  if (nested) {
    const nestedGid =
      typeof nested.admin_graphql_api_id === 'string'
        ? nested.admin_graphql_api_id
        : ''
    if (nestedGid.includes('/Order/')) return numericFromOrderGid(nestedGid)
    const nestedId = numericId(nested.id)
    if (nestedId) return nestedId
  }

  const fulfillmentOrder = asRecord(body.fulfillment_order)
  if (fulfillmentOrder) {
    const foOrderId = numericId(fulfillmentOrder.order_id)
    if (foOrderId) return foOrderId
  }

  return numericId(body.order_id)
}

export function shopifyWebhookOrderGid(body: Record<string, unknown>): string {
  const numeric = shopifyWebhookOrderNumericId(body)
  if (!numeric) return ''
  if (numeric.startsWith('gid://')) return numeric
  return `gid://shopify/Order/${numeric}`
}
