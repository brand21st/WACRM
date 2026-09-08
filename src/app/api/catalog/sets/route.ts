import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  catalogSchemaMissingResponse,
  catalogWriteErrorResponse,
  isCatalogSchemaError,
} from '@/lib/catalog/http'
import {
  buildCatalogSetDraft,
  catalogSetToJson,
  listCollectionsByAccount,
} from '@/lib/catalog'
import { upsertCollection } from '@/lib/catalog/core/commands'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const sets = await listCollectionsByAccount(supabase, accountId)
    return NextResponse.json({ sets: sets.map(catalogSetToJson) })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-sets:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const draft = await buildCatalogSetDraft(supabase, {
      accountId,
      input: body,
    })
    const set = await upsertCollection(supabase, draft)
    if (!set) {
      return NextResponse.json({ error: 'Could not create collection' }, { status: 400 })
    }
    return NextResponse.json({ set: catalogSetToJson(set) }, { status: 201 })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return catalogWriteErrorResponse(err) ?? toErrorResponse(err)
  }
}
