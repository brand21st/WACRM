import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyProductCard } from '@/lib/shopify'

import { MAX_PRODUCT_CARDS } from './product-card-limit'

export type CatalogCardQueue = {
  conversationId: string
  cards: ShopifyProductCard[]
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function parseCard(raw: unknown): ShopifyProductCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const title = str(row.title)
  const productUrl = str(row.productUrl)
  if (!title || !productUrl) return null
  return {
    title,
    imageUrl: str(row.imageUrl),
    productUrl,
    cartUrl: str(row.cartUrl),
    checkoutUrl: str(row.checkoutUrl),
    inStock: Boolean(row.inStock),
    caption: typeof row.caption === 'string' ? row.caption : title,
    retailerId: str(row.retailerId),
    handle: str(row.handle),
    variantId: str(row.variantId),
    catalogId: str(row.catalogId),
  }
}

export function parseCatalogCardQueue(raw: unknown): CatalogCardQueue | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const conversationId = str(row.conversationId)
  if (!conversationId) return null
  const cards = Array.isArray(row.cards)
    ? row.cards.map(parseCard).filter((card): card is ShopifyProductCard => Boolean(card))
    : []
  return { conversationId, cards: cards.slice(0, MAX_PRODUCT_CARDS) }
}

export async function loadCatalogCardQueue(
  db: SupabaseClient,
  accountId: string,
  contactId: string | null | undefined,
  conversationId: string,
): Promise<ShopifyProductCard[]> {
  if (!contactId) return []
  try {
    const { data, error } = await db
      .from('contact_ai_memory')
      .select('facts')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .maybeSingle()
    if (error || !data) return []
    const facts = (data as { facts?: { catalogCardQueue?: unknown } }).facts
    const queue = parseCatalogCardQueue(facts?.catalogCardQueue)
    if (!queue || queue.conversationId !== conversationId) return []
    return queue.cards
  } catch {
    return []
  }
}

export async function persistCatalogCardQueue(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  conversationId: string,
  cards: ShopifyProductCard[],
): Promise<void> {
  const { data, error } = await db
    .from('contact_ai_memory')
    .select('facts')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (error) throw error
  const facts =
    data?.facts && typeof data.facts === 'object' && !Array.isArray(data.facts)
      ? { ...(data.facts as Record<string, unknown>) }
      : {}
  if (cards.length === 0) {
    delete facts.catalogCardQueue
  } else {
    facts.catalogCardQueue = {
      conversationId,
      cards: cards.slice(0, MAX_PRODUCT_CARDS),
    }
  }
  const { error: upsertErr } = await db.from('contact_ai_memory').upsert(
    {
      account_id: accountId,
      contact_id: contactId,
      conversation_id: conversationId,
      facts,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'contact_id' },
  )
  if (upsertErr) throw upsertErr
}
