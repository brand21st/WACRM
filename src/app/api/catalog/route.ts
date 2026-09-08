import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  catalogProductToDetail,
  catalogProductToListItem,
  catalogSchemaMissingResponse,
  catalogWriteErrorResponse,
  isCatalogSchemaError,
  parseCatalogListCollection,
  parseCatalogListLimit,
  parseCatalogListOffset,
  parseCatalogListStatus,
} from '@/lib/catalog/http'
import {
  buildCatalogWriteDraft,
  listProductsByAccount,
  sanitizeCatalogSearch,
} from '@/lib/catalog'
import { upsertProduct } from '@/lib/catalog/core/commands'
import { listProductIdsForCollection } from '@/lib/catalog/core/repository'

/**
 * GET /api/catalog  (agent+)
 *
 * Lists first-party WACRM catalog products for the Catalog page.
 */
export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const q = sanitizeCatalogSearch(url.searchParams.get('q') ?? '')
    const status = parseCatalogListStatus(url.searchParams.get('status'))
    const collectionId = parseCatalogListCollection(url.searchParams.get('collection'))
    const limit = parseCatalogListLimit(url.searchParams.get('limit'))
    const offset = parseCatalogListOffset(url.searchParams.get('offset'))

    let memberIds: string[] | undefined
    if (collectionId) {
      memberIds = await listProductIdsForCollection(
        supabase,
        accountId,
        collectionId,
      )
      if (memberIds.length === 0) {
        return NextResponse.json({ products: [], total: 0 })
      }
    }

    const products = await listProductsByAccount(supabase, {
      accountId,
      text: q || undefined,
      status,
      collectionId,
      limit,
      offset,
    })

    let total = products.length
    let countReq = supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (status) countReq = countReq.eq('status', status)
    if (memberIds) {
      countReq = countReq.in('id', memberIds)
    }
    if (q) {
      const pattern = `%${q}%`
      countReq = countReq.or(
        `title.ilike.${pattern},description.ilike.${pattern},handle.ilike.${pattern}`,
      )
    }
    const { count, error: countError } = await countReq
    if (countError) {
      if (isCatalogSchemaError(countError)) return catalogSchemaMissingResponse()
    } else if (typeof count === 'number') {
      total = count
    }

    return NextResponse.json({
      products: products.map(catalogProductToListItem),
      total,
    })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}

/**
 * POST /api/catalog  (admin+)
 *
 * Create a first-party WACRM product through Catalog Core.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`catalog-write:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const draft = await buildCatalogWriteDraft(supabase, {
      accountId,
      input: body,
      origin: 'wacrm',
      locked: false,
    })
    const product = await upsertProduct(supabase, draft)
    if (!product) {
      return NextResponse.json({ error: 'Could not create product' }, { status: 400 })
    }
    return NextResponse.json({ product: catalogProductToDetail(product) }, { status: 201 })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return catalogWriteErrorResponse(err) ?? toErrorResponse(err)
  }
}
