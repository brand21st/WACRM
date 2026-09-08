import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  catalogProductToDetail,
  catalogSchemaMissingResponse,
  isCatalogSchemaError,
} from '@/lib/catalog/http'
import { getCatalogProduct } from '@/lib/catalog'
import { upsertProduct } from '@/lib/catalog/core/commands'

export async function POST(
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

    const product = await upsertProduct(supabase, {
      id: existing.id,
      accountId,
      handle: existing.handle,
      title: existing.title,
      description: existing.description,
      status: 'active',
      brand: existing.brand,
      productUrl: existing.productUrl,
      currency: existing.currency,
      priceMin: existing.priceMin,
      priceMax: existing.priceMax,
      origin: existing.origin,
      locked: existing.origin === 'shopify_import' ? true : existing.locked,
      publishedAt: existing.publishedAt ?? new Date().toISOString(),
      variants: existing.variants.map((variant) => ({
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        currency: variant.currency,
        available: variant.available,
        inventoryQuantity: variant.inventoryQuantity,
        options: variant.options,
        sortOrder: variant.sortOrder,
        retailerId: variant.retailerId,
      })),
      media: existing.media.map((item) => ({
        url: item.url,
        alt: item.alt,
        role: item.role,
        sortOrder: item.sortOrder,
        storagePath: item.storagePath,
      })),
    })
    if (!product) {
      return NextResponse.json({ error: 'Could not publish product' }, { status: 400 })
    }
    return NextResponse.json({ product: catalogProductToDetail(product) })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
