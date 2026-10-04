import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { registerCatalogWebhooks, webhookCallbackUrl } from '@/lib/shopify/register-webhooks'
import { ShopifyError } from '@/lib/shopify/client'

/**
 * POST /api/shopify/webhooks/register  (admin+)
 *
 * Re-registers catalog, page, and order webhook topics on the connected shop.
 */
export async function POST() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `shopify-webhooks:${userId}`,
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

    const address = webhookCallbackUrl()
    if (!address) {
      return NextResponse.json(
        { error: 'NEXT_PUBLIC_SITE_URL is unset — cannot register webhooks.' },
        { status: 400 },
      )
    }

    const result = await registerCatalogWebhooks(config)
    return NextResponse.json({
      success: true,
      address,
      registered: result.registered,
      skipped: result.skipped,
    })
  } catch (err) {
    if (err instanceof ShopifyError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return toErrorResponse(err)
  }
}
