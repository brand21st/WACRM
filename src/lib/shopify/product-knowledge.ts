import type { SupabaseClient } from '@supabase/supabase-js'

import { ingestDocument } from '@/lib/ai/knowledge'
import { loadEmbeddingsKey } from '@/lib/ai/config'
import type { ShopifyProductHit } from './types'
import { SHOPIFY_PRODUCT_KB_PREFIX } from './product-knowledge-prefix'

export { SHOPIFY_PRODUCT_KB_PREFIX }

export function shopifyProductKnowledgeTitle(title: string): string {
  const trimmed = title.trim() || 'Product'
  return `${SHOPIFY_PRODUCT_KB_PREFIX}${trimmed}`
}

export function formatShopifyProductKnowledge(hit: ShopifyProductHit): string {
  const title = hit.title.trim() || 'Product'
  const description = hit.description.trim()
  const price = formatPrice(hit)
  const variants = formatVariants(hit)
  const parts = [
    title,
    description && description !== title ? description : '',
    price,
    variants,
    hit.productUrl ? `URL: ${hit.productUrl}` : '',
  ]
  return parts.filter(Boolean).join('\n\n')
}

export async function upsertShopifyProductKnowledge(
  db: SupabaseClient,
  accountId: string,
  hit: ShopifyProductHit,
): Promise<string | null> {
  const sourceUrl = hit.productUrl?.trim()
  if (!sourceUrl) return null
  const title = shopifyProductKnowledgeTitle(hit.title)
  const content = formatShopifyProductKnowledge(hit)
  if (!content.trim()) return null

  const { data: existing, error: findErr } = await db
    .from('ai_knowledge_documents')
    .select('id, title, content')
    .eq('account_id', accountId)
    .eq('source_url', sourceUrl)
    .maybeSingle()
  if (findErr) throw findErr

  if (
    existing?.id &&
    existing.content === content &&
    existing.title === title
  ) {
    return existing.id as string
  }

  const now = new Date().toISOString()
  let documentId = existing?.id as string | undefined
  if (documentId) {
    const { error } = await db
      .from('ai_knowledge_documents')
      .update({
        title,
        content,
        source_type: 'url',
        last_scraped_at: now,
        scrape_error: null,
      })
      .eq('id', documentId)
      .eq('account_id', accountId)
    if (error) throw error
  } else {
    const { data: inserted, error } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        title,
        content,
        source_type: 'url',
        source_url: sourceUrl,
        last_scraped_at: now,
        scrape_error: null,
      })
      .select('id')
      .single()
    if (error || !inserted?.id) throw error ?? new Error('insert failed')
    documentId = inserted.id
  }
  if (!documentId) throw new Error('document id missing')

  const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, accountId)
  await ingestDocument(
    db,
    accountId,
    { embeddingsApiKey },
    documentId,
    content,
    title,
  )
  return documentId
}

export async function removeShopifyProductKnowledge(
  db: SupabaseClient,
  accountId: string,
  args: { productUrls?: string[]; productIds?: string[] },
): Promise<void> {
  const urls = new Set(
    (args.productUrls ?? []).map((url) => url.trim()).filter(Boolean),
  )
  const ids = (args.productIds ?? []).map((id) => id.trim()).filter(Boolean)
  if (ids.length > 0) {
    const { data } = await db
      .from('shopify_catalog_products')
      .select('product_url')
      .eq('account_id', accountId)
      .in('shopify_product_id', ids)
    for (const row of data ?? []) {
      const url = String(row.product_url ?? '').trim()
      if (url) urls.add(url)
    }
  }
  if (urls.size === 0) return
  const { error } = await db
    .from('ai_knowledge_documents')
    .delete()
    .eq('account_id', accountId)
    .in('source_url', [...urls])
  if (error) throw error
}

export async function removeAllShopifyProductKnowledge(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { error } = await db
    .from('ai_knowledge_documents')
    .delete()
    .eq('account_id', accountId)
    .like('title', `${SHOPIFY_PRODUCT_KB_PREFIX}%`)
  if (error) throw error
}

export async function syncShopifyProductKnowledge(
  db: SupabaseClient,
  accountId: string,
  hits: ShopifyProductHit[],
): Promise<void> {
  const keep = new Set<string>()
  for (const hit of hits) {
    const url = hit.productUrl?.trim()
    if (url) keep.add(url)
    try {
      await upsertShopifyProductKnowledge(db, accountId, hit)
    } catch (err) {
      console.warn('[shopify/product-knowledge] ingest failed:', err)
    }
  }

  const { data: existing, error } = await db
    .from('ai_knowledge_documents')
    .select('id, source_url')
    .eq('account_id', accountId)
    .like('title', `${SHOPIFY_PRODUCT_KB_PREFIX}%`)
  if (error) throw error

  const stale = (existing ?? []).filter((doc) => {
    const url = String(doc.source_url ?? '').trim()
    return !url || !keep.has(url)
  })
  if (stale.length === 0) return
  const { error: delErr } = await db
    .from('ai_knowledge_documents')
    .delete()
    .eq('account_id', accountId)
    .in(
      'id',
      stale.map((doc) => doc.id),
    )
  if (delErr) throw delErr
}

function formatPrice(hit: ShopifyProductHit): string {
  const min = hit.priceMin?.trim() ?? ''
  const max = hit.priceMax?.trim() ?? ''
  if (!min && !max) return ''
  const currency = hit.currency?.trim() ? ` ${hit.currency.trim()}` : ''
  if (min && max && min !== max) return `Price: ${min}–${max}${currency}`
  return `Price: ${min || max}${currency}`
}

function formatVariants(hit: ShopifyProductHit): string {
  const lines = hit.variants.slice(0, 24).map((variant) => {
    const price = variant.price ? ` ${variant.price}` : ''
    const stock = variant.available === false ? 'out of stock' : 'in stock'
    return `${variant.title}${price} (${stock})`
  })
  if (lines.length === 0) return ''
  return `Variants:\n${lines.join('\n')}`
}
