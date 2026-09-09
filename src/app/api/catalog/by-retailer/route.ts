import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  catalogSchemaMissingResponse,
  isCatalogSchemaError,
} from '@/lib/catalog/http'
import { enrichInboundCartItems } from '@/lib/commerce/enrich-cart-items'

const MAX_IDS = 20

/**
 * GET /api/catalog/by-retailer?ids=a,b  (agent+)
 *
 * Resolve WhatsApp cart retailer IDs to product name / price so the
 * inbox can render older inbound carts that were stored without titles.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const ids = parseRetailerIds(url.searchParams.get('ids'))
    if (ids.length === 0) {
      return NextResponse.json({ items: [] })
    }

    const enriched = await enrichInboundCartItems(
      supabase,
      accountId,
      ids.map((id) => ({ product_retailer_id: id, quantity: 1 })),
    )

    return NextResponse.json({
      items: enriched.map((item) => ({
        retailer_id: item.product_retailer_id,
        name: item.name ?? null,
        price: item.item_price ?? null,
        compare_at: item.compare_at_price ?? null,
        currency: item.currency ?? null,
        image_url: item.image_url ?? null,
      })),
    })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}

export function parseRetailerIds(raw: string | null): string[] {
  if (!raw?.trim()) return []
  return [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))].slice(
    0,
    MAX_IDS,
  )
}
