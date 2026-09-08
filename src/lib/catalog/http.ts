import { NextResponse } from 'next/server'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import type { CatalogProduct, CatalogStatus } from './core/types'
import { isCatalogStatus } from './core/status'
import { CatalogWriteError } from './http-write'

export const CATALOG_SCHEMA_MISSING = 'CATALOG_SCHEMA_MISSING'

export interface CatalogListItem {
  id: string
  title: string
  handle: string
  status: CatalogStatus
  origin: CatalogProduct['origin']
  currency: string | null
  priceMin: number | null
  priceMax: number | null
  variantCount: number
  imageUrl: string | null
  sets: { id: string; title: string }[]
}

export function isCatalogSchemaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const error = err as { message?: string; code?: string }
  return isMissingDbRelation(error, 'catalog_products')
}

export function catalogWriteErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof CatalogWriteError) {
    return NextResponse.json({ error: err.message }, { status: 400 })
  }
  return null
}

export function catalogSchemaMissingResponse() {
  return NextResponse.json(
    {
      error: 'Catalog is not ready yet',
      code: CATALOG_SCHEMA_MISSING,
    },
    { status: 503 },
  )
}

export function parseCatalogListCollection(raw: string | null): string | undefined {
  const id = raw?.trim()
  return id || undefined
}

export function parseCatalogListStatus(raw: string | null): CatalogStatus | undefined {
  if (!raw || raw === 'all') return undefined
  return isCatalogStatus(raw) ? raw : undefined
}

export function parseCatalogListLimit(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 50
  const n = Number(raw)
  if (!Number.isFinite(n)) return 50
  return Math.min(100, Math.max(1, Math.trunc(n)))
}

export function parseCatalogListOffset(raw: string | null): number {
  if (raw == null || raw.trim() === '') return 0
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.trunc(n)
}

export function catalogProductToDetail(product: CatalogProduct) {
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    status: product.status,
    brand: product.brand,
    productUrl: product.productUrl,
    currency: product.currency,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    origin: product.origin,
    locked: product.locked,
    publishedAt: product.publishedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
    variants: product.variants,
    media: product.media.map((item) => ({
      id: item.id,
      url: item.url,
      alt: item.alt,
      role: item.role,
      sortOrder: item.sortOrder,
      storagePath: item.storagePath ?? null,
    })),
    collections: (product.collections ?? []).map((item) => ({
      id: item.id,
      handle: item.handle,
      title: item.title,
      status: item.status,
    })),
  }
}

export function catalogProductToListItem(product: CatalogProduct): CatalogListItem {
  const hero = product.media.find((media) => media.role === 'hero')
  const first = product.media[0]
  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    status: product.status,
    origin: product.origin,
    currency: product.currency,
    priceMin: product.priceMin,
    priceMax: product.priceMax,
    variantCount: product.variants.length,
    imageUrl: hero?.url ?? first?.url ?? null,
    sets: (product.collections ?? []).map((item) => ({
      id: item.id,
      title: item.title,
    })),
  }
}
