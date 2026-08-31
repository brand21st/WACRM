import type { SupabaseClient } from '@supabase/supabase-js'

import { shopifyGraphql } from './client'
import { loadShopifyConfig } from './config'
import { htmlToText } from './html-to-text'
import { numericIdFromGid } from './map-product'
import { storePageUrl } from './permalinks'
import {
  PAGE_BY_ID_QUERY,
  PAGES_SYNC_QUERY,
  SHOP_POLICIES_QUERY,
} from './queries'
import { sanitizeSearch } from './catalog'
import { isMissingDbFunction, isMissingDbRelation } from './config-db'
import type { ShopifyStoreConfig } from './types'

export const MAX_STORE_PAGES = 100
const PAGE_SYNC_SIZE = 50
const BODY_MAX = 20_000
const EXCERPT_MAX = 800

export type StoreContentKind = 'policy' | 'page'

export interface ShopifyStoreContentHit {
  kind: StoreContentKind
  title: string
  handle: string | null
  body: string
  pageUrl: string | null
}

interface ShopPolicyNode {
  type?: string | null
  title?: string | null
  body?: string | null
  url?: string | null
}

interface PageNode {
  id?: string | null
  handle?: string | null
  title?: string | null
  body?: string | null
  isPublished?: boolean | null
}

interface StoreContentRow {
  kind: StoreContentKind
  title: string
  handle: string | null
  body: string
  page_url: string | null
}

export function toPageGid(idOrGid: string): string {
  const raw = idOrGid.trim()
  if (raw.startsWith('gid://')) return raw
  if (/^\d+$/.test(raw)) return `gid://shopify/Page/${raw}`
  return raw
}

export function policyResourceId(type: string): string {
  return `gid://shopify/ShopPolicy/${type.trim().toUpperCase()}`
}

function policyHandle(type: string): string {
  return type
    .trim()
    .toLowerCase()
    .replace(/_/g, '-')
}

function rowFromPolicy(
  accountId: string,
  policy: ShopPolicyNode,
  syncedAt: string,
): Record<string, unknown> | null {
  const type = (policy.type || '').trim()
  const title = (policy.title || '').trim()
  const body = htmlToText(policy.body || '', BODY_MAX)
  if (!type || !title || !body) return null
  return {
    account_id: accountId,
    shopify_resource_id: policyResourceId(type),
    kind: 'policy',
    handle: policyHandle(type),
    title,
    body,
    page_url: policy.url?.trim() || null,
    synced_at: syncedAt,
  }
}

function rowFromPage(
  accountId: string,
  node: PageNode,
  primaryDomain: string | null,
  syncedAt: string,
): Record<string, unknown> | null {
  const id = (node.id || '').trim()
  const handle = (node.handle || '').trim()
  const title = (node.title || '').trim()
  if (!id || !handle || !title) return null
  if (node.isPublished === false) return null
  return {
    account_id: accountId,
    shopify_resource_id: id,
    kind: 'page',
    handle,
    title,
    body: htmlToText(node.body || '', BODY_MAX),
    page_url: storePageUrl(primaryDomain, handle) || null,
    synced_at: syncedAt,
  }
}

export async function refreshContentSyncMetadata(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const { count, error: countErr } = await db
    .from('shopify_store_content')
    .select('*', { count: 'exact', head: true })
    .eq('account_id', accountId)
  if (countErr) throw countErr

  const { error: updErr } = await db
    .from('shopify_configs')
    .update({
      last_content_sync_at: new Date().toISOString(),
      content_item_count: count ?? 0,
    })
    .eq('account_id', accountId)
  if (updErr) {
    if (updErr.code === '42703' || updErr.code === 'PGRST204') return
    throw updErr
  }
}

export async function syncStoreContent(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
): Promise<{ count: number; warning?: string }> {
  const syncedAt = new Date().toISOString()
  const rows: Record<string, unknown>[] = []

  try {
    const data = await shopifyGraphql<{
      shop?: { shopPolicies?: ShopPolicyNode[] | null }
    }>({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: SHOP_POLICIES_QUERY,
    })
    for (const policy of data.shop?.shopPolicies ?? []) {
      const row = rowFromPolicy(config.accountId, policy, syncedAt)
      if (row) rows.push(row)
    }
  } catch (err) {
    console.warn('[shopify/store-content] policy sync failed:', err)
  }

  try {
    let after: string | null = null
    let pageCount = 0
    while (pageCount < MAX_STORE_PAGES) {
      const cursor = after
      const pageData: {
        pages?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
          nodes?: PageNode[]
        }
      } = await shopifyGraphql({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        query: PAGES_SYNC_QUERY,
        variables: { first: PAGE_SYNC_SIZE, after: cursor },
        timeoutMs: 45_000,
      })
      for (const node of pageData.pages?.nodes ?? []) {
        const row = rowFromPage(
          config.accountId,
          node,
          config.primaryDomain,
          syncedAt,
        )
        if (!row) continue
        rows.push(row)
        pageCount += 1
        if (pageCount >= MAX_STORE_PAGES) break
      }
      if (
        pageCount >= MAX_STORE_PAGES ||
        !pageData.pages?.pageInfo?.hasNextPage ||
        !pageData.pages.pageInfo.endCursor
      ) {
        break
      }
      after = pageData.pages.pageInfo.endCursor
    }
  } catch (err) {
    console.warn('[shopify/store-content] page sync failed:', err)
  }

  if (!rows.some((r) => r.kind === 'policy')) {
    try {
      const { fetchStorefrontPolicies } = await import('./storefront-content')
      rows.push(
        ...(await fetchStorefrontPolicies(config, config.accountId, syncedAt)),
      )
    } catch (err) {
      console.warn('[shopify/store-content] storefront policy fallback failed:', err)
    }
  }

  if (!rows.some((r) => r.kind === 'page')) {
    try {
      const { fetchStorefrontPages } = await import('./storefront-content')
      rows.push(
        ...(await fetchStorefrontPages(config, config.accountId, syncedAt)),
      )
    } catch (err) {
      console.warn('[shopify/store-content] storefront page fallback failed:', err)
    }
  }

  const persist = await persistStoreContentRows(db, config.accountId, rows)
  if (persist.ok && !persist.warning) {
    try {
      await refreshContentSyncMetadata(db, config.accountId)
    } catch (err) {
      console.warn('[shopify/store-content] metadata update failed:', err)
    }
  }

  return {
    count: persist.ok ? rows.length : 0,
    warning: persist.warning,
  }
}

async function persistStoreContentRows(
  db: SupabaseClient,
  accountId: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: boolean; warning?: string }> {
  const { error: delErr } = await db
    .from('shopify_store_content')
    .delete()
    .eq('account_id', accountId)

  if (delErr && (delErr.code === 'PGRST205' || /shopify_store_content/i.test(delErr.message ?? ''))) {
    if (rows.length === 0) {
      return {
        ok: false,
        warning:
          'Run migration 047 (shopify_store_content) and add read_content + read_legal_policies, then reinstall the app.',
      }
    }
    const kb = await persistAsKnowledgeDocuments(db, accountId, rows)
    return kb
  }
  if (delErr) throw delErr

  if (rows.length > 0) {
    const { error } = await db.from('shopify_store_content').insert(rows)
    if (error) throw error
  }
  return { ok: true }
}

export const SHOPIFY_KB_PREFIX = '[Shopify] '

const DELIVERY_INTENT_RE =
  /\b(deliver(?:y|ies|ed|ing)?|shipping|ship(?:s|ped|ment)?|dispatch|eta|transit|arriv(?:e|al|ing)|how long|when will|pin\s?code|pincode|courier)\b/i

export function isDeliveryOrShippingIntent(query: string): boolean {
  return DELIVERY_INTENT_RE.test(query)
}

/** Original query plus synonyms so “delivery time” still hits a Shipping policy. */
export function storeContentSearchNeedles(query: string): string[] {
  const q = sanitizeSearch(query)
  if (!q) return []
  const needles = [q]
  if (isDeliveryOrShippingIntent(q)) {
    for (const extra of ['shipping', 'delivery', 'dispatch']) {
      if (!needles.some((n) => n.toLowerCase() === extra)) needles.push(extra)
    }
  }
  return needles
}

function hasWord(haystack: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack)
}

function scoreStoreDoc(
  title: string,
  body: string,
  needles: string[],
  shippingIntent: boolean,
): number {
  let score = 0
  for (const n of needles) {
    const nl = n.toLowerCase()
    if (!nl) continue
    if (hasWord(title, nl) || title.toLowerCase().includes(nl)) score += 10
    if (hasWord(body, nl) || body.toLowerCase().includes(nl)) score += 3
    for (const tok of nl.split(/\s+/).filter((w) => w.length > 2)) {
      if (hasWord(title, tok)) score += 4
      if (hasWord(body, tok)) score += 2
    }
  }
  if (shippingIntent && /\b(ship|deliver)/i.test(title)) score += 25
  return score
}

async function persistAsKnowledgeDocuments(
  db: SupabaseClient,
  accountId: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: boolean; warning?: string }> {
  const { data: existing } = await db
    .from('ai_knowledge_documents')
    .select('id, title')
    .eq('account_id', accountId)
    .like('title', `${SHOPIFY_KB_PREFIX}%`)

  for (const doc of existing ?? []) {
    await db.from('ai_knowledge_documents').delete().eq('id', doc.id)
  }

  const { ingestDocument } = await import('@/lib/ai/knowledge')
  for (const row of rows) {
    const title = `${SHOPIFY_KB_PREFIX}${String(row.title ?? 'Page')}`
    const content = String(row.body ?? '').trim()
    if (!content) continue
    const { data: doc, error } = await db
      .from('ai_knowledge_documents')
      .insert({ account_id: accountId, title, content })
      .select('id')
      .single()
    if (error || !doc) {
      console.error('[shopify/store-content] knowledge fallback insert failed:', error)
      continue
    }
    try {
      await ingestDocument(db, accountId, { embeddingsApiKey: null }, doc.id, content)
    } catch (err) {
      console.warn('[shopify/store-content] knowledge ingest failed:', err)
    }
  }

  return {
    ok: true,
    warning:
      'Saved policies into the AI knowledge base. Run migration 047 to store them as Shopify pages & policies.',
  }
}

export async function removeStoreContent(
  db: SupabaseClient,
  accountId: string,
  resourceId: string,
): Promise<boolean> {
  const raw = resourceId.trim()
  if (!raw) return false

  const ids = new Set<string>([raw])
  if (/^\d+$/.test(raw)) {
    ids.add(toPageGid(raw))
  } else if (raw.startsWith('gid://shopify/Page/')) {
    ids.add(numericIdFromGid(raw))
  }

  const { error, count } = await db
    .from('shopify_store_content')
    .delete({ count: 'exact' })
    .eq('account_id', accountId)
    .in('shopify_resource_id', [...ids])

  if (error) throw error
  return (count ?? 0) > 0
}

export async function upsertStoreContentPage(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  pageId: string,
): Promise<boolean> {
  const gid = toPageGid(pageId)
  const data = await shopifyGraphql<{ page?: PageNode | null }>({
    shopDomain: config.shopDomain,
    accessToken: config.accessToken,
    query: PAGE_BY_ID_QUERY,
    variables: { id: gid },
  })

  const node = data.page
  if (!node?.id || node.isPublished === false) {
    await removeStoreContent(db, config.accountId, gid)
    await refreshContentSyncMetadata(db, config.accountId)
    return false
  }

  const row = rowFromPage(
    config.accountId,
    node,
    config.primaryDomain,
    new Date().toISOString(),
  )
  if (!row) {
    await removeStoreContent(db, config.accountId, gid)
    await refreshContentSyncMetadata(db, config.accountId)
    return false
  }

  const { error } = await db
    .from('shopify_store_content')
    .upsert(row, { onConflict: 'account_id,shopify_resource_id' })
  if (error) throw error

  await refreshContentSyncMetadata(db, config.accountId)
  return true
}

export async function handleShopifyPageWebhook(
  db: SupabaseClient,
  accountId: string,
  topic: string,
  body: Record<string, unknown>,
): Promise<void> {
  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  if (!config) return

  const pageId =
    body.admin_graphql_api_id != null
      ? String(body.admin_graphql_api_id)
      : body.id != null
        ? String(body.id)
        : ''

  if (topic === 'pages/delete') {
    if (pageId) {
      const removed = await removeStoreContent(db, accountId, pageId)
      if (removed) await refreshContentSyncMetadata(db, accountId)
    }
    return
  }

  if (topic === 'pages/create' || topic === 'pages/update') {
    const publishedAt = body.published_at
    if (publishedAt === null || publishedAt === '') {
      if (pageId) {
        const removed = await removeStoreContent(db, accountId, pageId)
        if (removed) await refreshContentSyncMetadata(db, accountId)
      }
      return
    }
    if (pageId) {
      await upsertStoreContentPage(db, config, pageId)
    }
  }
}

export async function searchStoreContent(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit = 5,
): Promise<ShopifyStoreContentHit[]> {
  const needles = storeContentSearchNeedles(query)
  if (needles.length === 0 || limit <= 0) return []

  const picked = new Map<string, ShopifyStoreContentHit>()
  const addHit = (hit: ShopifyStoreContentHit | null) => {
    if (!hit) return
    const key = `${hit.kind}:${hit.title}`
    if (picked.has(key)) return
    picked.set(key, hit)
  }

  let tableMissing = false

  for (const q of needles) {
    if (picked.size >= limit || tableMissing) break
    try {
      const { data, error } = await db.rpc('match_shopify_store_content_fts', {
        p_account_id: accountId,
        p_query: q,
        p_match_count: limit,
      })
      if (error) {
        if (
          isMissingDbRelation(error, 'shopify_store_content') ||
          isMissingDbFunction(error, 'match_shopify_store_content_fts')
        ) {
          tableMissing = true
          break
        }
        console.error('[shopify/store-content] FTS search failed:', error)
        continue
      }
      if (!Array.isArray(data)) continue
      for (const row of data as StoreContentRow[]) {
        addHit(rowToHit(row))
        if (picked.size >= limit) break
      }
    } catch (err) {
      console.error('[shopify/store-content] FTS search failed:', err)
    }
  }

  if (!tableMissing && picked.size < limit) {
    try {
      const select = 'kind, title, handle, body, page_url'
      const tryCol = async (column: 'title' | 'body' | 'handle', q: string) => {
        const { data, error } = await db
          .from('shopify_store_content')
          .select(select)
          .eq('account_id', accountId)
          .ilike(column, `%${q}%`)
          .limit(limit)
        if (error) {
          if (isMissingDbRelation(error, 'shopify_store_content')) {
            tableMissing = true
            return []
          }
          console.error(`[shopify/store-content] snapshot search (${column}) failed:`, error)
          return []
        }
        return (data ?? []) as StoreContentRow[]
      }
      outer: for (const q of needles) {
        for (const col of ['title', 'handle', 'body'] as const) {
          if (tableMissing || picked.size >= limit) break outer
          for (const row of await tryCol(col, q)) {
            addHit(rowToHit(row))
            if (picked.size >= limit) break outer
          }
        }
      }
    } catch (err) {
      console.error('[shopify/store-content] snapshot search failed:', err)
    }
  }

  if (picked.size < limit) {
    for (const hit of await searchShopifyKnowledgeFallback(
      db,
      accountId,
      needles,
      limit,
    )) {
      addHit(hit)
      if (picked.size >= limit) break
    }
  }

  return Array.from(picked.values()).slice(0, limit)
}

async function searchShopifyKnowledgeFallback(
  db: SupabaseClient,
  accountId: string,
  needles: string[],
  limit: number,
): Promise<ShopifyStoreContentHit[]> {
  try {
    const { data, error } = await db
      .from('ai_knowledge_documents')
      .select('title, content')
      .eq('account_id', accountId)
      .like('title', `${SHOPIFY_KB_PREFIX}%`)
      .limit(80)
    if (error || !data?.length) return []

    const shippingIntent = needles.some((n) => isDeliveryOrShippingIntent(n))
    const scored = data
      .map((doc) => {
        const rawTitle = String(doc.title || '').trim()
        const body = String(doc.content || '').trim()
        if (!rawTitle || !body) return null
        const score = scoreStoreDoc(rawTitle, body, needles, shippingIntent)
        if (score <= 0) return null
        const title = rawTitle.startsWith(SHOPIFY_KB_PREFIX)
          ? rawTitle.slice(SHOPIFY_KB_PREFIX.length).trim()
          : rawTitle
        const kind: StoreContentKind =
          /policy|privacy|refund|shipping|terms/i.test(title) ? 'policy' : 'page'
        const handle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        return {
          score,
          hit: {
            kind,
            title,
            handle: handle || null,
            body,
            pageUrl: null,
          } satisfies ShopifyStoreContentHit,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => b.score - a.score)

    const ranked = shippingIntent
      ? scored.filter(
          (row) =>
            /\b(ship|deliver)/i.test(row.hit.title) ||
            /\bdeliver/i.test(row.hit.body),
        )
      : scored

    return (ranked.length > 0 ? ranked : scored)
      .slice(0, limit)
      .map((row) => row.hit)
  } catch (err) {
    console.error('[shopify/store-content] knowledge fallback search failed:', err)
    return []
  }
}

export async function retrieveShopifyStoreContent(
  db: SupabaseClient,
  accountId: string,
  queryText: string,
  k = 5,
): Promise<string[]> {
  try {
    const hits = await searchStoreContent(db, accountId, queryText, k)
    return hits.map(formatContentExcerpt)
  } catch (err) {
    console.error('[shopify/store-content] retrieve failed:', err)
    return []
  }
}

function rowToHit(row: StoreContentRow): ShopifyStoreContentHit | null {
  const title = (row.title || '').trim()
  if (!title) return null
  const kind = row.kind === 'policy' ? 'policy' : 'page'
  return {
    kind,
    title,
    handle: row.handle,
    body: row.body || '',
    pageUrl: row.page_url,
  }
}

function formatContentExcerpt(hit: ShopifyStoreContentHit): string {
  const label = hit.kind === 'policy' ? 'Policy' : 'Page'
  const body =
    hit.body.length > EXCERPT_MAX
      ? `${hit.body.slice(0, EXCERPT_MAX - 1)}…`
      : hit.body
  const url = hit.pageUrl ? `\nURL: ${hit.pageUrl}` : ''
  return `${label}: ${hit.title}${url}\n${body}`.trim()
}
