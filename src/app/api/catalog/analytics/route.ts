import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { catalogSchemaMissingResponse, isCatalogSchemaError } from '@/lib/catalog/http'
import {
  loadCatalogAnalyticsDashboard,
  loadCatalogAnalyticsMode,
  parseCatalogAnalyticsRange,
} from '@/lib/catalog'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const enabled = (await loadCatalogAnalyticsMode(supabase, accountId)) === 'on'
    if (!enabled) {
      return NextResponse.json({ enabled: false })
    }
    const url = new URL(request.url)
    const range = parseCatalogAnalyticsRange(url.searchParams.get('range'))
    const dashboard = await loadCatalogAnalyticsDashboard(supabase, accountId, range)
    return NextResponse.json({ enabled: true, ...dashboard })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
