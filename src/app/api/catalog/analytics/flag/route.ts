import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { catalogSchemaMissingResponse, isCatalogSchemaError } from '@/lib/catalog/http'
import { loadCatalogAnalyticsMode, setCatalogAnalyticsMode } from '@/lib/catalog'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const enabled = (await loadCatalogAnalyticsMode(supabase, accountId)) === 'on'
    return NextResponse.json({ enabled })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-analytics:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const body = await request.json().catch(() => null)
    const enabled = body && typeof body === 'object' && body.enabled === true
    const mode = await setCatalogAnalyticsMode(supabase, accountId, enabled ? 'on' : 'off')
    return NextResponse.json({ enabled: mode === 'on' })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
