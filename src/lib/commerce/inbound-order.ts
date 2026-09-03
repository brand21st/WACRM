import type { InboundCartItem } from './types'
import { sanitizeWebhookText } from './sanitize'

export interface ParsedInboundOrder {
  catalog_id: string | null
  items: InboundCartItem[]
  previewText: string
}

export function parseInboundOrderMessage(message: {
  order?: unknown
}): ParsedInboundOrder | null {
  const order = asRecord(message.order)
  if (!order) return null
  const itemsRaw = order.product_items
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) return null

  const items: InboundCartItem[] = []
  for (const raw of itemsRaw) {
    const row = asRecord(raw)
    if (!row) continue
    const retailerId = sanitizeWebhookText(row.product_retailer_id, 100)
    const quantity = Math.max(1, Math.floor(Number(row.quantity) || 1))
    if (!retailerId) continue
    const price = Number(row.item_price)
    items.push({
      product_retailer_id: retailerId,
      quantity,
      item_price: Number.isFinite(price) && price >= 0 ? price : undefined,
      currency: sanitizeWebhookText(row.currency, 8) || undefined,
      name: sanitizeWebhookText(row.name, 120) || undefined,
    })
  }
  if (items.length === 0) return null

  const catalogId = sanitizeWebhookText(order.catalog_id, 64) || null
  const previewText = formatInboundOrderPreview(items)
  return { catalog_id: catalogId, items, previewText }
}

export function formatInboundOrderPreview(items: InboundCartItem[]): string {
  const lines = items.map((item) => {
    const label = item.name?.trim() || item.product_retailer_id
    return `${label} × ${item.quantity}`
  })
  return `Cart: ${lines.join(', ')}`.slice(0, 1024)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
