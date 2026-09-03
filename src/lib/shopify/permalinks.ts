import { storefrontOrigin } from './domain'

export function storePageUrl(
  primaryDomain: string | null | undefined,
  handle: string,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const h = handle.replace(/^\/+|\/+$/g, '')
  if (!origin || !h) return ''
  return `${origin}/pages/${h}`
}

export function productPageUrl(
  primaryDomain: string | null | undefined,
  handle: string,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const h = handle.replace(/^\/+|\/+$/g, '')
  if (!origin || !h) return ''
  return `${origin}/products/${h}`
}

export function cartPermalink(
  primaryDomain: string | null | undefined,
  legacyVariantId: string,
  quantity = 1,
): string {
  const origin = storefrontOrigin(primaryDomain)
  const id = String(legacyVariantId).trim()
  const qty = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1
  if (!origin || !id) return ''
  return `${origin}/cart/${id}:${qty}`
}

export function checkoutPermalink(
  primaryDomain: string | null | undefined,
  legacyVariantId: string,
  quantity = 1,
): string {
  const cart = cartPermalink(primaryDomain, legacyVariantId, quantity)
  return cart ? `${cart}?checkout` : ''
}

export interface CartPermalinkItem {
  variantId: string
  quantity?: number
}

function cartSegment(item: CartPermalinkItem): string | null {
  const id = String(item.variantId ?? '').trim()
  if (!id) return null
  const raw = item.quantity
  const qty = Number.isFinite(raw) && Number(raw) > 0 ? Math.floor(Number(raw)) : 1
  return `${id}:${qty}`
}

/** Multi-item storefront cart: `/cart/id:qty,id:qty`. Dedupes by variant id. */
export function cartPermalinkMulti(
  primaryDomain: string | null | undefined,
  items: CartPermalinkItem[],
): string {
  const origin = storefrontOrigin(primaryDomain)
  const seen = new Set<string>()
  const parts: string[] = []
  for (const item of items) {
    const segment = cartSegment(item)
    if (!segment) continue
    const id = segment.slice(0, segment.lastIndexOf(':'))
    if (seen.has(id)) continue
    seen.add(id)
    parts.push(segment)
  }
  if (!origin || parts.length === 0) return ''
  return `${origin}/cart/${parts.join(',')}`
}

export function checkoutPermalinkMulti(
  primaryDomain: string | null | undefined,
  items: CartPermalinkItem[],
): string {
  const cart = cartPermalinkMulti(primaryDomain, items)
  return cart ? `${cart}?checkout` : ''
}

/** Parse `/cart/id:qty,id:qty` (with or without `?checkout`) into line items. */
export function parseCartPermalink(url: string): CartPermalinkItem[] {
  const raw = url.trim()
  if (!raw) return []
  let path = raw
  try {
    path = new URL(raw).pathname
  } catch {
    path = raw.split(/[?#]/)[0] ?? raw
  }
  const match = path.match(/\/cart\/([^/]+)/i)
  if (!match?.[1]) return []
  let segment = match[1]
  try {
    segment = decodeURIComponent(segment)
  } catch {
    // keep raw segment
  }
  const items: CartPermalinkItem[] = []
  for (const part of segment.split(',')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const colon = trimmed.lastIndexOf(':')
    const variantId = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim()
    const qtyRaw = colon === -1 ? '1' : trimmed.slice(colon + 1)
    if (!variantId) continue
    const qty = Number(qtyRaw)
    items.push({
      variantId,
      quantity: Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1,
    })
  }
  return items
}
