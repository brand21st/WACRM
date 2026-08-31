import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { syncCatalog } from '@/lib/shopify/catalog'
import { syncStoreContent } from '@/lib/shopify/store-content'
import { ShopifyError } from '@/lib/shopify/client'

/**
 * POST /api/shopify/catalog/sync  (admin+)
 *
 * Pulls active products from Shopify into `shopify_catalog_products`,
 * then refreshes policies and pages into `shopify_store_content`.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `shopify-sync:${userId}`,
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
            'Connect Shopify first (Save connection). If you use shpss_ secret, fill Client ID and save again (or run scripts/repair-shopify-credentials.mts).',
        },
        { status: 400 },
      )
    }

    const result = await syncCatalog(supabase, config)
    let contentCount = 0
    let contentWarning: string | undefined
    try {
      const content = await syncStoreContent(supabase, config)
      contentCount = content.count
      contentWarning = content.warning
    } catch (err) {
      console.error('[shopify/catalog/sync] store content sync failed:', err)
      contentWarning =
        err instanceof Error
          ? err.message
          : 'Could not sync pages and policies from Shopify.'
    }
    return NextResponse.json({
      success: true,
      count: result.count,
      content_count: contentCount,
      content_warning: contentWarning ?? null,
      last_catalog_sync_at: new Date().toISOString(),
      last_content_sync_at:
        contentCount > 0 || !contentWarning ? new Date().toISOString() : null,
    })
  } catch (err) {
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[shopify/catalog/sync]', err)
    return toErrorResponse(err)
  }
}
