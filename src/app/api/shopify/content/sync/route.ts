import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { syncStoreContent } from '@/lib/shopify/store-content'
import { ShopifyError } from '@/lib/shopify/client'

const LIST_PAGE_SIZE = 1000

async function listAllRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error: { message: string } | null }> {
  const rows: T[] = []
  for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
    const { data, error } = await fetchPage(offset, offset + LIST_PAGE_SIZE - 1)
    if (error) return { rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < LIST_PAGE_SIZE) break
  }
  return { rows, error: null }
}

/**
 * GET /api/shopify/content/sync  (any member)
 *
 * Lists synced Shopify policies and pages for the Knowledge panel.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const [contentRes, productRes] = await Promise.all([
      listStoreContent(supabase, accountId),
      listCatalogProducts(supabase, accountId),
    ])
    if (contentRes.error) {
      console.error('[shopify/content/sync GET]', contentRes.error)
    }
    const items = contentRes.rows.map((row) => ({
      ...row,
      body: String(row.body ?? ''),
    }))
    const products = (productRes.error ? [] : productRes.rows).map((row) => {
      const body = String(row.body || row.body_excerpt || '')
      return {
        id: String(row.shopify_product_id),
        title: String(row.title ?? ''),
        handle: row.handle ?? null,
        page_url: row.product_url ?? null,
        image_url: row.image_url ? String(row.image_url) : null,
        body,
        price_min: row.price_min != null ? String(row.price_min) : null,
        price_max: row.price_max != null ? String(row.price_max) : null,
        currency: row.currency != null ? String(row.currency) : null,
        variants: summarizeCatalogVariants(row.variant_summary),
      }
    })
    return NextResponse.json({
      items,
      products,
      count: items.length,
      product_count: products.length,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/shopify/content/sync  (admin+)
 *
 * Pulls shop policies and Online Store pages into `shopify_store_content`.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `shopify-content-sync:${userId}`,
      RATE_LIMITS.shopifyCatalogSync,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const config = await loadShopifyConfig(supabase, accountId, {
      requireActive: false,
    })
    if (!config) {
      return NextResponse.json(
        {
          error:
            'Connect Shopify first (Save connection). If you use shpss_ secret, fill Client ID and save again.',
        },
        { status: 400 },
      )
    }

    const result = await syncStoreContent(supabase, config)
    return NextResponse.json({
      success: true,
      count: result.count,
      last_content_sync_at: new Date().toISOString(),
    })
  } catch (err) {
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[shopify/content/sync]', err)
    return toErrorResponse(err)
  }
}

async function listStoreContent(db: SupabaseClient, accountId: string) {
  return listAllRows<{
    id: string
    kind: string
    title: string
    handle: string | null
    page_url: string | null
    body: string | null
    synced_at: string | null
  }>((from, to) =>
    db
      .from('shopify_store_content')
      .select('id, kind, title, handle, page_url, body, synced_at')
      .eq('account_id', accountId)
      .order('kind', { ascending: true })
      .order('title', { ascending: true })
      .range(from, to),
  )
}

async function listCatalogProducts(db: SupabaseClient, accountId: string) {
  return listAllRows<{
    shopify_product_id: string
    handle: string | null
    title: string | null
    body: string | null
    body_excerpt: string | null
    price_min: number | string | null
    price_max: number | string | null
    currency: string | null
    product_url: string | null
    image_url: string | null
    variant_summary: unknown
  }>((from, to) =>
    db
      .from('shopify_catalog_products')
      .select(
        'shopify_product_id, handle, title, body, body_excerpt, price_min, price_max, currency, product_url, image_url, variant_summary',
      )
      .eq('account_id', accountId)
      .order('title', { ascending: true })
      .range(from, to),
  )
}

function summarizeCatalogVariants(raw: unknown): Array<{
  title: string
  price: string | null
  available: boolean
  sku: string | null
}> {
  if (!Array.isArray(raw)) return []
  return raw.map((entry) => {
    const row =
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    return {
      title: String(row.title ?? 'Default'),
      price: row.price != null ? String(row.price) : null,
      available: row.available !== false,
      sku: typeof row.sku === 'string' ? row.sku : null,
    }
  })
}
