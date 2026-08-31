import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { syncStoreContent } from '@/lib/shopify/store-content'
import { ShopifyError } from '@/lib/shopify/client'

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
