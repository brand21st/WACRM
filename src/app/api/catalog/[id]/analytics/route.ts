import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { catalogSchemaMissingResponse, isCatalogSchemaError } from '@/lib/catalog/http'
import {
  getCatalogProduct,
  loadCatalogAnalyticsMode,
  loadProductAnalytics,
  parseCatalogAnalyticsRange,
} from '@/lib/catalog'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const enabled = (await loadCatalogAnalyticsMode(supabase, accountId)) === 'on'
    if (!enabled) return NextResponse.json({ enabled: false })
    const { id } = await context.params
    const product = await getCatalogProduct(supabase, accountId, id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const range = parseCatalogAnalyticsRange(new URL(request.url).searchParams.get('range'))
    const metrics = await loadProductAnalytics(supabase, accountId, id, range)
    return NextResponse.json({ enabled: true, ...metrics })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
