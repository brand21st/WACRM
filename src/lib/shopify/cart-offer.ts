import type { SupabaseClient } from '@supabase/supabase-js'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import {
  cartPermalinkMulti,
  checkoutPermalinkMulti,
  parseCartPermalink,
} from './permalinks'
import type { ShopifyProductCard } from './types'

export const MAX_CART_ITEMS = 3

export interface CartOfferItem {
  variantId: string
  quantity: number
  title: string
  price?: string | null
  imageUrl?: string | null
}

export interface CartOffer {
  items: CartOfferItem[]
  cartUrl: string
  checkoutUrl: string
  summaryLines: string[]
}

export function itemsFromProductCards(
  cards: ShopifyProductCard[],
): CartOfferItem[] {
  const items: CartOfferItem[] = []
  const seen = new Set<string>()
  for (const card of cards) {
    if (!card.inStock) continue
    const parsed = parseCartPermalink(card.cartUrl || card.checkoutUrl || '')
    const first = parsed[0]
    if (!first?.variantId || seen.has(first.variantId)) continue
    seen.add(first.variantId)
    items.push({
      variantId: first.variantId,
      quantity: first.quantity ?? 1,
      title: card.title.trim() || 'Item',
      price: priceFromCaption(card.caption, card.title),
      imageUrl: card.imageUrl,
    })
    if (items.length >= MAX_CART_ITEMS) break
  }
  return items
}

export function itemsFromInteractiveRows(
  rows: {
    interactive_payload?: unknown
    content_text?: string | null
  }[],
): CartOfferItem[] {
  const items: CartOfferItem[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const payload = asCtaPayload(row.interactive_payload)
    if (!payload) continue
    const parsed = parseCartPermalink(payload.url)
    if (parsed.length === 0) continue
    const title = firstLine(payload.body || row.content_text) || 'Item'
    for (const part of parsed) {
      if (!part.variantId || seen.has(part.variantId)) continue
      seen.add(part.variantId)
      items.push({
        variantId: part.variantId,
        quantity: part.quantity ?? 1,
        title: parsed.length === 1 ? title : title,
        imageUrl: payload.header_image ?? null,
      })
      if (items.length >= MAX_CART_ITEMS) return items
    }
  }
  return items
}

export function buildCartOffer(
  primaryDomain: string | null | undefined,
  items: CartOfferItem[],
): CartOffer | null {
  const capped = items.slice(0, MAX_CART_ITEMS)
  if (capped.length === 0) return null
  const cartUrl = cartPermalinkMulti(primaryDomain, capped)
  const checkoutUrl = checkoutPermalinkMulti(primaryDomain, capped)
  if (!cartUrl || !checkoutUrl) return null
  return {
    items: capped,
    cartUrl,
    checkoutUrl,
    summaryLines: capped.map(formatSummaryLine),
  }
}

export function cartOfferFallbackText(items: CartOfferItem[]): string {
  if (items.length === 0) return ''
  return `Here is your cart:\n${items.map((item) => `• ${formatSummaryLine(item)}`).join('\n')}`
}

export async function loadLastShownCartItems(
  db: SupabaseClient,
  conversationId: string,
): Promise<CartOfferItem[]> {
  const { data, error } = await db
    .from('messages')
    .select('interactive_payload, content_text')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'bot')
    .eq('content_type', 'interactive')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw error
  return itemsFromInteractiveRows(data ?? [])
}

export async function resolveCartOfferItems(args: {
  db: SupabaseClient
  conversationId?: string | null
  cards: ShopifyProductCard[]
}): Promise<CartOfferItem[]> {
  const fromCards = itemsFromProductCards(args.cards)
  if (fromCards.length > 0) return fromCards
  if (!args.conversationId) return []
  try {
    return await loadLastShownCartItems(args.db, args.conversationId)
  } catch (err) {
    console.warn('[shopify cart-offer] loadLastShownCartItems failed:', err)
    return []
  }
}

function formatSummaryLine(item: CartOfferItem): string {
  const qty = item.quantity > 1 ? ` ×${item.quantity}` : ''
  const price = item.price?.trim() ? ` — ${item.price.trim()}` : ''
  return `${item.title}${qty}${price}`
}

function priceFromCaption(caption: string, title: string): string | null {
  for (const line of caption.split('\n')) {
    const text = line.trim()
    if (!text || text === title.trim()) continue
    if (/^stock\s/i.test(text)) continue
    if (/^view:/i.test(text)) continue
    if (/^variants:/i.test(text)) continue
    if (/^colou?r:/i.test(text)) continue
    return text
  }
  return null
}

function firstLine(text: string | null | undefined): string {
  return (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? ''
}

function asCtaPayload(
  raw: unknown,
): InteractiveMessagePayload & { kind: 'cta_url' } | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Partial<InteractiveMessagePayload>
  if (p.kind !== 'cta_url') return null
  if (typeof p.url !== 'string' || !p.url.includes('/cart/')) return null
  return p as InteractiveMessagePayload & { kind: 'cta_url' }
}
