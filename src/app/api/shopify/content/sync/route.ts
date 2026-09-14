import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { syncStoreContent } from '@/lib/shopify/store-content'
import { ShopifyError } from '@/lib/shopify/client'

/**
 * GET /api/shopify/content/sync  (any member)
 *
 * Lists synced Shopify policies and pages for the Knowledge panel.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('shopify_store_content')
      .select('id, kind, title, handle, page_url, synced_at')
      .eq('account_id', accountId)
      .order('kind', { ascending: true })
      .order('title', { ascending: true })
      .limit(100)
    if (error) {
      console.error('[shopify/content/sync GET]', error)
      return NextResponse.json({ items: [], count: 0 })
    }
    return NextResponse.json({
      items: data ?? [],
      count: data?.length ?? 0,
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
