import type { SupabaseClient } from '@supabase/supabase-js'
import { validateCatalogIds } from '../intelligence/shopping-context'
import { getProductByRetailerId } from '../core/repository'

export const CATALOG_ANALYTICS_EVENTS = [
  'search_match',
  'shown',
  'add_to_cart',
  'purchase',
] as const

export type CatalogAnalyticsEvent = (typeof CATALOG_ANALYTICS_EVENTS)[number]
export type CatalogAnalyticsMode = 'off' | 'on'
export type CatalogAnalyticsSource =
  | 'search_products'
  | 'get_product'
  | 'card_send'
  | 'whatsapp_order'

export async function loadCatalogAnalyticsMode(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogAnalyticsMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('catalog_analytics')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return 'off'
    return data?.catalog_analytics === 'on' ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

export async function setCatalogAnalyticsMode(
  db: SupabaseClient,
  accountId: string,
  mode: CatalogAnalyticsMode,
): Promise<CatalogAnalyticsMode> {
  const next = mode === 'on' ? 'on' : 'off'
  const { data: existing, error: readErr } = await db
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (readErr) throw readErr
  if (existing?.id) {
    const { error } = await db
      .from('ai_configs')
      .update({ catalog_analytics: next })
      .eq('account_id', accountId)
    if (error) throw error
    return next
  }
  throw new Error('Save AI settings first, then enable catalog analytics.')
}

export async function recordCatalogProductEvents(
  db: SupabaseClient,
  args: {
    accountId: string
    event: CatalogAnalyticsEvent
    source: CatalogAnalyticsSource
    productIds: string[]
    conversationId?: string | null
    contactId?: string | null
    quantity?: number
    variantId?: string | null
  },
): Promise<void> {
  try {
    const mode = await loadCatalogAnalyticsMode(db, args.accountId)
    if (mode !== 'on') return
    const ids = await validateCatalogIds(db, args.accountId, args.productIds)
    if (ids.length === 0) return
    const quantity = Math.max(1, Math.trunc(args.quantity ?? 1))
    const payload = ids.map((productId) => ({
      account_id: args.accountId,
      product_id: productId,
      variant_id: args.variantId ?? null,
      conversation_id: args.conversationId ?? null,
      contact_id: args.contactId ?? null,
      event: args.event,
      quantity,
      source: args.source,
    }))
    const { error } = await db.from('catalog_product_events').insert(payload)
    if (error) throw error
  } catch (err) {
    console.warn('[catalog-analytics] event write failed', err)
  }
}

export async function recordCatalogLineEvents(
  db: SupabaseClient,
  args: {
    accountId: string
    event: 'add_to_cart' | 'purchase'
    conversationId?: string | null
    contactId?: string | null
    lines: Array<{ retailer_id?: string | null; quantity?: number | null }>
  },
): Promise<void> {
  try {
    const mode = await loadCatalogAnalyticsMode(db, args.accountId)
    if (mode !== 'on') return
    for (const line of args.lines) {
      const retailerId = typeof line.retailer_id === 'string' ? line.retailer_id.trim() : ''
      if (!retailerId) continue
      const product = await getProductByRetailerId(db, args.accountId, retailerId)
      if (!product) continue
      const variant = product.variants.find((item) => item.retailerId === retailerId)
      const quantity = Math.max(1, Math.trunc(Number(line.quantity) || 1))
      await recordCatalogProductEvents(db, {
        accountId: args.accountId,
        event: args.event,
        source: 'whatsapp_order',
        productIds: [product.id],
        conversationId: args.conversationId,
        contactId: args.contactId,
        quantity,
        variantId: variant?.id ?? null,
      })
    }
  } catch (err) {
    console.warn('[catalog-analytics] line event write failed', err)
  }
}
