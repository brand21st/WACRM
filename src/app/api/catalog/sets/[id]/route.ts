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
  getCollectionById,
} from '@/lib/catalog'
import { deleteCollection, upsertCollection } from '@/lib/catalog/core/commands'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const set = await getCollectionById(supabase, accountId, id)
    if (!set) return NextResponse.json({ error: 'Set not found' }, { status: 404 })
    return NextResponse.json({ set: catalogSetToJson(set) })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-sets:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const existing = await getCollectionById(supabase, accountId, id)
    if (!existing) return NextResponse.json({ error: 'Set not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const draft = await buildCatalogSetDraft(supabase, {
      accountId,
      input: body,
      existingHandle: existing.handle,
      existingId: existing.id,
    })
    const set = await upsertCollection(supabase, draft)
    if (!set) {
      return NextResponse.json({ error: 'Could not update set' }, { status: 400 })
    }
    return NextResponse.json({ set: catalogSetToJson(set) })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return catalogWriteErrorResponse(err) ?? toErrorResponse(err)
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-sets:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const existing = await getCollectionById(supabase, accountId, id)
    if (!existing) return NextResponse.json({ error: 'Set not found' }, { status: 404 })
    const ok = await deleteCollection(supabase, accountId, id)
    if (!ok) return NextResponse.json({ error: 'Could not delete set' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
