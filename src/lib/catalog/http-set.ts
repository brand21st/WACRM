import type { SupabaseClient } from '@supabase/supabase-js'
import { CatalogWriteError, slugifyCatalogHandle } from './http-write'
import type { CatalogCollection, CatalogCollectionDraft, CatalogStatus } from './core/types'
import { isCatalogStatus } from './core/status'

export interface CatalogSetWriteInput {
  title?: unknown
  handle?: unknown
  status?: unknown
  productIds?: unknown
}

export function catalogSetToJson(set: CatalogCollection) {
  return {
    id: set.id,
    handle: set.handle,
    title: set.title,
    status: set.status,
    productCount: set.productCount ?? set.productIds?.length ?? 0,
    productIds: set.productIds ?? [],
    metaProductSetId: set.metaProductSetId ?? null,
    metaSynced: Boolean(set.metaProductSetId),
    metaCollectionReview: set.metaCollectionReview ?? null,
  }
}

export async function buildCatalogSetDraft(
  db: SupabaseClient,
  opts: {
    accountId: string
    input: CatalogSetWriteInput
    existingHandle?: string
    existingId?: string
  },
): Promise<CatalogCollectionDraft> {
  const title = requiredText(opts.input.title, 'Set title')
  const handleRaw =
    optionalText(opts.input.handle) || opts.existingHandle || slugifyCatalogHandle(title)
  const handle = slugifyCatalogHandle(handleRaw)
  const productIds = parseIds(opts.input.productIds)
  await assertProductsOwned(db, opts.accountId, productIds)
  return {
    id: opts.existingId,
    accountId: opts.accountId,
    handle,
    title,
    status: parseSetStatus(opts.input.status),
    productIds,
  }
}

function parseSetStatus(raw: unknown): CatalogStatus {
  if (raw == null || raw === '') return 'active'
  if (typeof raw !== 'string' || !isCatalogStatus(raw)) {
    throw new CatalogWriteError('Invalid set status')
  }
  return raw
}

async function assertProductsOwned(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return
  const { data, error } = await db
    .from('catalog_products')
    .select('id')
    .eq('account_id', accountId)
    .in('id', productIds)
  if (error) throw error
  const owned = new Set((data ?? []).map((row) => String(row.id)))
  if (productIds.some((id) => !owned.has(id))) {
    throw new CatalogWriteError('Products must belong to this account')
  }
}

function parseIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map((id) => String(id ?? '').trim()).filter(Boolean))]
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
