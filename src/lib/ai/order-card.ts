import { stripCheckoutUrlsFromReply } from './checkout-cta'
import type { ShopifyOrderCard, ShopifyOrderHit } from '@/lib/shopify/types'

export const TRACK_ORDER_BUTTON_LABEL = 'Track order'
export const VIEW_ORDER_BUTTON_LABEL = 'View order'

const CTA_BODY_MAX = 1024
const MAX_ORDER_CARDS = 3

export function firstTrackingUrl(
  tracking: ShopifyOrderHit['tracking'],
): string | null {
  for (const item of tracking) {
    const url = item.url?.trim()
    if (url) return url
  }
  return null
}

export function orderCardCta(hit: ShopifyOrderHit): {
  buttonLabel: string | null
  url: string | null
} {
  const trackingUrl = firstTrackingUrl(hit.tracking)
  if (trackingUrl) {
    return { buttonLabel: TRACK_ORDER_BUTTON_LABEL, url: trackingUrl }
  }
  const statusUrl = hit.statusPageUrl?.trim() || null
  if (statusUrl) {
    return { buttonLabel: VIEW_ORDER_BUTTON_LABEL, url: statusUrl }
  }
  return { buttonLabel: null, url: null }
}

export function formatOrderMoney(
  amount: string | null | undefined,
  currency: string | null | undefined,
): string {
  const raw = (amount ?? '').trim()
  if (!raw) return ''
  const n = Number(raw)
  const code = (currency ?? '').trim()
  if (!Number.isFinite(n)) return code ? `${raw} ${code}` : raw
  if (!code) return raw
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `${raw} ${code}`
  }
}

function lineItemLabel(item: ShopifyOrderHit['lineItems'][number]): string {
  const variant =
    item.variantTitle?.trim() &&
    !/^default(?: title)?$/i.test(item.variantTitle.trim())
      ? ` (${item.variantTitle.trim()})`
      : ''
  const title = `${item.title.trim() || 'Item'}${variant}`
  const price = formatOrderMoney(item.price, item.currency)
  const qty = item.quantity > 0 ? item.quantity : 1
  return price ? `${qty} × ${title} — ${price}` : `${qty} × ${title}`
}

export function orderCardBody(
  hit: ShopifyOrderHit,
  contactPhone?: string | null,
): string {
  const name = hit.customerName?.trim() || ''
  const phone = hit.customerPhone?.trim() || contactPhone?.trim() || ''
  const total = formatOrderMoney(hit.total, hit.currency)
  const lines = [
    name ? `Name: ${name}` : '',
    phone ? `Phone: ${phone}` : '',
    hit.name?.trim() ? `Order: ${hit.name.trim()}` : '',
    ...hit.lineItems.map(lineItemLabel),
    total ? `Total: ${total}` : '',
  ].filter(Boolean)
  return (lines.join('\n') || hit.name?.trim() || 'Order').slice(0, CTA_BODY_MAX)
}

export function orderCardFromHit(
  hit: ShopifyOrderHit,
  contactPhone?: string | null,
): ShopifyOrderCard {
  const cta = orderCardCta(hit)
  return {
    orderName: hit.name?.trim() || '',
    bodyText: orderCardBody(hit, contactPhone),
    buttonLabel: cta.buttonLabel,
    url: cta.url,
  }
}

export function orderCardsFromHits(
  hits: ShopifyOrderHit[],
  contactPhone?: string | null,
): ShopifyOrderCard[] {
  return hits.slice(0, MAX_ORDER_CARDS).map((hit) => orderCardFromHit(hit, contactPhone))
}

export function stripOrderUrlsFromReply(
  text: string,
  cards: ShopifyOrderCard[],
): string {
  let out = stripCheckoutUrlsFromReply(
    text,
    cards.map((card) => card.url),
  )
  out = out.replace(/\b(?:Track(?:\s+order)?|Tracking|View order)\s*:\s*/gi, '')
  out = out.replace(/[ \t]+\n/g, '\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out.trim()
}
