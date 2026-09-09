import type { InboundCartItem } from './types'
import { sanitizeWebhookText } from './sanitize'

export interface ParsedInboundOrder {
  catalog_id: string | null
  items: InboundCartItem[]
  previewText: string
}

export interface CartMoneyTotal {
  amount: number
  currency: string
}

/** Rebuild the webhook `order` envelope from a stored inbox cart payload. */
export function webhookMessageFromInboundCart(payload: {
  catalog_id?: string
  items: InboundCartItem[]
}): { order: { catalog_id?: string; product_items: InboundCartItem[] } } {
  return {
    order: {
      catalog_id: payload.catalog_id,
      product_items: payload.items,
    },
  }
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
  const total = cartItemsTotal(items)
  const suffix = total ? ` · ${formatCartMoney(total.amount, total.currency)}` : ''
  return `Cart: ${lines.join(', ')}${suffix}`.slice(0, 1024)
}

export function cartItemCount(items: InboundCartItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(1, item.quantity || 1), 0)
}

/** Sum of priced lines only. Null when no line has a price. */
export function cartItemsTotal(items: InboundCartItem[]): CartMoneyTotal | null {
  let amount = 0
  let currency = ''
  let priced = false
  for (const item of items) {
    const { unit } = pickCartDisplayPrice({
      whatsapp: item.item_price,
      catalog: item.item_price,
      compareAt: item.compare_at_price,
    })
    if (unit == null) continue
    priced = true
    amount += unit * Math.max(1, item.quantity || 1)
    if (!currency && item.currency) currency = item.currency
  }
  if (!priced) return null
  return { amount, currency: currency || 'INR' }
}

/**
 * Catalog list/sale price for inbox carts. WhatsApp often sends a ₹1
 * stub while `compare_at` holds the real product price.
 */
export function pickCartDisplayPrice(args: {
  whatsapp?: number
  catalog?: number
  compareAt?: number
}): { unit?: number; compareAt?: number } {
  const catalog = toDisplayPrice(args.catalog)
  const whatsapp = toDisplayPrice(args.whatsapp)
  const compareAt = toDisplayPrice(args.compareAt)
  const sell = catalog ?? whatsapp
  if (compareAt != null && sell != null && compareAt > sell) {
    if (sell <= 1) return { unit: compareAt }
    return { unit: sell, compareAt }
  }
  if (catalog != null) {
    return {
      unit: catalog,
      compareAt:
        compareAt != null && compareAt > catalog ? compareAt : undefined,
    }
  }
  if (whatsapp != null) return { unit: whatsapp }
  if (compareAt != null) return { unit: compareAt }
  return {}
}

function toDisplayPrice(raw: number | undefined): number | undefined {
  return raw != null && Number.isFinite(raw) && raw >= 0 ? raw : undefined
}

/** Product-price formatter (2 fraction digits). Do not use deal `formatCurrency`. */
export function formatCartMoney(amount: number, currency?: string): string {
  const code = (currency || 'INR').trim() || 'INR'
  const value = Number.isFinite(amount) ? amount : 0
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return `${code} ${new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value)}`
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
