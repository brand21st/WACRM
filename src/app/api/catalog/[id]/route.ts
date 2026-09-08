import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  catalogProductToDetail,
  catalogSchemaMissingResponse,
  catalogWriteErrorResponse,
  isCatalogSchemaError,
} from '@/lib/catalog/http'
import {
  attachCatalogFacts,
  buildCatalogWriteDraft,
  getCatalogProduct,
  listCollectionsByAccount,
} from '@/lib/catalog'
import { deleteProduct, upsertProduct } from '@/lib/catalog/core/commands'

async function loadOwnedProduct(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  id: string,
) {
  const product = await getCatalogProduct(supabase, accountId, id)
  if (!product) return null
  const [withFacts] = await attachCatalogFacts(supabase, accountId, [product])
  return withFacts ?? product
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const product = await loadOwnedProduct(supabase, accountId, id)
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const collections = await listCollectionsByAccount(supabase, accountId).catch(() => [])
    return NextResponse.json({
      product: catalogProductToDetail(product),
      collections,
    })
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
    const limit = checkRateLimit(`catalog-write:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const existing = await loadOwnedProduct(supabase, accountId, id)
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const draft = await buildCatalogWriteDraft(supabase, {
      accountId,
      input: body,
      origin: existing.origin,
      locked: existing.origin === 'shopify_import' ? true : existing.locked,
      existingHandle: existing.handle,
      existingProductId: existing.id,
      existingPublishedAt: existing.publishedAt,
      existingRetailerIds: existing.variants.map((variant) => variant.retailerId),
    })
    draft.id = existing.id
    const product = await upsertProduct(supabase, draft)
    if (!product) {
      return NextResponse.json({ error: 'Could not update product' }, { status: 400 })
    }
    const saved = await loadOwnedProduct(supabase, accountId, product.id)
    return NextResponse.json({ product: catalogProductToDetail(saved ?? product) })
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
    const limit = checkRateLimit(`catalog-write:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await context.params
    const existing = await getCatalogProduct(supabase, accountId, id)
    if (!existing) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const ok = await deleteProduct(supabase, accountId, id)
    if (!ok) return NextResponse.json({ error: 'Could not delete product' }, { status: 400 })
    return NextResponse.json({ success: true })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
