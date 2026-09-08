import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { loadMetaCatalogPicker } from '@/lib/catalog/meta-catalogs'

/**
 * GET /api/catalog/meta-catalogs  (agent+)
 *
 * Lists Meta Commerce catalogs connected to this WhatsApp account.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const payload = await loadMetaCatalogPicker(supabase, accountId)
    return NextResponse.json(payload)
  } catch (err) {
    return toErrorResponse(err)
  }
}
