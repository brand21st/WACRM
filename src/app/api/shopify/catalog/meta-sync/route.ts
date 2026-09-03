import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { syncMetaCatalog } from '@/lib/shopify/meta-catalog-sync'

/**
 * POST /api/shopify/catalog/meta-sync  (admin+)
 *
 * Pushes the local Shopify snapshot into the Meta Commerce catalog.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `shopify-meta-sync:${userId}`,
      RATE_LIMITS.shopifyCatalogSync,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const result = await syncMetaCatalog(supabase, accountId)
    return NextResponse.json({
      success: true,
      count: result.count,
      last_meta_catalog_sync_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Meta catalog sync failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
