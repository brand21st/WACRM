import type { SupabaseClient } from '@supabase/supabase-js'
import { getProductByHandle } from './core/repository'
import { isCatalogStatus } from './core/status'
import { CATALOG_MEDIA_ROLES, type CatalogMediaRole, type CatalogOrigin, type CatalogProductDraft, type CatalogStatus, type CatalogVariantDraft } from './core/types'

export class CatalogWriteError extends Error {
  readonly status = 400 as const
  constructor(message: string) {
    super(message)
    this.name = 'CatalogWriteError'
  }
}

export interface CatalogWriteVariantInput {
  title?: unknown
  sku?: unknown
  price?: unknown
  compareAtPrice?: unknown
  currency?: unknown
  available?: unknown
  inventoryQuantity?: unknown
  options?: unknown
  retailerId?: unknown
}

export interface CatalogWriteMediaInput {
  url?: unknown
  alt?: unknown
  role?: unknown
  sortOrder?: unknown
  storagePath?: unknown
}

export interface CatalogWriteInput {
  title?: unknown
  description?: unknown
  brand?: unknown
  handle?: unknown
  productUrl?: unknown
  currency?: unknown
  status?: unknown
  variants?: unknown
  media?: unknown
  collectionIds?: unknown
}

export function slugifyCatalogHandle(raw: string): string {
  const slug = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return slug || 'product'
}

export function makeWacrmRetailerId(
  handle: string,
  sort: number,
  sku?: string | null,
): string {
  const trimmed = sku?.trim()
  if (trimmed) return trimmed
  return `wacrm_${handle}_${sort}`
}

export function isAccountCatalogStoragePath(accountId: string, path: string): boolean {
  return path.startsWith(`account-${accountId}/catalog/`)
}

export function pricesFromVariants(
  variants: Array<{ price?: number | null }>,
): { priceMin: number | null; priceMax: number | null } {
  const prices = variants
    .map((variant) => variant.price)
    .filter((price): price is number => price != null && Number.isFinite(price))
  if (prices.length === 0) return { priceMin: null, priceMax: null }
  return {
    priceMin: Math.min(...prices),
    priceMax: Math.max(...prices),
  }
}

export async function uniquifyHandle(
  db: SupabaseClient,
  accountId: string,
  desired: string,
  exceptProductId?: string | null,
): Promise<string> {
  const base = slugifyCatalogHandle(desired)
  for (let i = 0; i < 20; i += 1) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`.slice(0, 80)
    const existing = await getProductByHandle(db, accountId, candidate)
    if (!existing || existing.id === exceptProductId) return candidate
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 80)
}

export async function buildCatalogWriteDraft(
  db: SupabaseClient,
  args: {
    accountId: string
    input: CatalogWriteInput
    origin: CatalogOrigin
    locked: boolean
    existingHandle?: string | null
    existingProductId?: string | null
    existingPublishedAt?: string | null
    existingRetailerIds?: string[]
  },
): Promise<CatalogProductDraft> {
  const title = requiredText(args.input.title, 'Product name')
  const handle = await uniquifyHandle(
    db,
    args.accountId,
    optionalText(args.input.handle) || title,
    args.existingProductId,
  )
  const status = parseWriteStatus(args.input.status)
  const variants = parseVariants(args.input.variants, handle, args.existingRetailerIds ?? [])
  const media = parseMedia(args.input.media, args.accountId)
  const { priceMin, priceMax } = pricesFromVariants(variants)
  const currency = optionalText(args.input.currency)?.toUpperCase() ?? variants[0]?.currency ?? null
  const publishedAt =
    status === 'active'
      ? args.existingPublishedAt ?? new Date().toISOString()
      : args.existingPublishedAt ?? null

  await assertSkusAvailable(db, args.accountId, args.existingProductId ?? null, variants)

  return {
    accountId: args.accountId,
    handle,
    title,
    description: optionalText(args.input.description) ?? '',
    status,
    brand: optionalText(args.input.brand),
    productUrl: optionalText(args.input.productUrl),
    currency,
    priceMin,
    priceMax,
    origin: args.origin,
    locked: args.locked,
    publishedAt,
    variants,
    media,
    collectionIds: parseCollectionIds(args.input.collectionIds),
  }
}

function parseWriteStatus(raw: unknown): CatalogStatus {
  if (raw == null || raw === '') return 'draft'
  if (!isCatalogStatus(raw)) throw new CatalogWriteError('Invalid product status')
  return raw.trim().toLowerCase() as CatalogStatus
}

function parseVariants(
  raw: unknown,
  handle: string,
  existingRetailerIds: string[],
): CatalogVariantDraft[] {
  const rows = Array.isArray(raw) ? raw : []
  const variants = (rows.length > 0 ? rows : [{}]).map((row, index) => {
    const input = (row && typeof row === 'object' ? row : {}) as CatalogWriteVariantInput
    const sku = optionalText(input.sku)
    const retailerId =
      optionalText(input.retailerId) ||
      existingRetailerIds[index] ||
      makeWacrmRetailerId(handle, index, sku)
    const options = parseOptions(input.options)
    const title =
      optionalText(input.title) ||
      (options.length > 0 ? options.map((opt) => opt.value).join(' / ') : 'Default')
    return {
      title,
      sku,
      price: optionalNumber(input.price, 'price'),
      compareAtPrice: optionalNumber(input.compareAtPrice, 'compare-at price'),
      currency: optionalText(input.currency)?.toUpperCase() ?? null,
      available: input.available !== false,
      inventoryQuantity: optionalInteger(input.inventoryQuantity, 'stock'),
      options,
      sortOrder: index,
      retailerId,
    } satisfies CatalogVariantDraft
  })
  if (variants.length === 0) throw new CatalogWriteError('Add at least one variant')
  const seen = new Set<string>()
  for (const variant of variants) {
    if (seen.has(variant.retailerId)) {
      throw new CatalogWriteError('Each variant needs a unique SKU or retailer id')
    }
    seen.add(variant.retailerId)
  }
  return variants
}

function parseMedia(
  raw: unknown,
  accountId: string,
): CatalogProductDraft['media'] {
  if (!Array.isArray(raw)) return []
  return raw.map((row, index) => {
    const input = (row && typeof row === 'object' ? row : {}) as CatalogWriteMediaInput
    const url = requiredText(input.url, 'Image URL')
    const storagePath = optionalText(input.storagePath)
    if (storagePath && !isAccountCatalogStoragePath(accountId, storagePath)) {
      throw new CatalogWriteError('Image path does not belong to this account')
    }
    const role = optionalText(input.role)
    return {
      url,
      alt: optionalText(input.alt),
      role: (CATALOG_MEDIA_ROLES.includes(role as CatalogMediaRole)
        ? role
        : index === 0
          ? 'hero'
          : 'listing') as CatalogMediaRole,
      sortOrder: optionalInteger(input.sortOrder, 'image order') ?? index,
      storagePath,
    }
  })
}

function parseOptions(raw: unknown): { name: string; value: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const name = optionalText((row as { name?: unknown }).name)
      const value = optionalText((row as { value?: unknown }).value)
      if (!name || !value) return null
      return { name, value }
    })
    .filter((row): row is { name: string; value: string } => Boolean(row))
}

function parseCollectionIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.map((id) => String(id ?? '').trim()).filter(Boolean)
}

async function assertSkusAvailable(
  db: SupabaseClient,
  accountId: string,
  productId: string | null,
  variants: CatalogVariantDraft[],
): Promise<void> {
  const skus = variants.map((variant) => variant.sku?.trim()).filter(Boolean) as string[]
  const unique = new Set(skus)
  if (unique.size !== skus.length) {
    throw new CatalogWriteError('Each variant SKU must be unique')
  }
  if (skus.length === 0) return
  const { data, error } = await db
    .from('catalog_variants')
    .select('id, product_id, sku')
    .eq('account_id', accountId)
    .in('sku', skus)
  if (error) throw error
  const clash = (data ?? []).find((row) => String(row.product_id) !== productId)
  if (clash) throw new CatalogWriteError('That SKU is already used by another product')
}

function requiredText(raw: unknown, label: string): string {
  const value = optionalText(raw)
  if (!value) throw new CatalogWriteError(`${label} is required`)
  return value
}

function optionalText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value || null
}

function optionalNumber(raw: unknown, label: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) throw new CatalogWriteError(`Invalid ${label}`)
  return n
}

function optionalInteger(raw: unknown, label: string): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new CatalogWriteError(`Invalid ${label}`)
  }
  return n
}
