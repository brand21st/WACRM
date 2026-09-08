import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueCatalogMetaSync } from '@/lib/queue/enqueue'
import {
  commerceMetaCatalogIds,
  loadCommerceSettings,
} from '@/lib/shopify/commerce-config'

export const CATALOG_SYNC_CLAIM_STALE_MS = 3 * 60 * 1000
export const FULL_SYNC_INLINE_BUDGET = 2

export type CatalogSyncOp = 'upsert' | 'delete' | 'set_upsert' | 'set_delete'
export type CatalogSyncStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

export interface CatalogSetOutboxPayload {
  title?: string | null
  previousTitle?: string | null
  metaProductSetId?: string | null
}

export interface CatalogSyncOutboxRow {
  id: string
  accountId: string
  productId: string | null
  collectionId: string | null
  op: CatalogSyncOp
  status: CatalogSyncStatus
  retailerIds: string[]
  payload: CatalogSetOutboxPayload
  coalesceKey: string
  attempts: number
  lastError: string | null
  claimedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EnqueueCatalogSyncOptions {
  /** Manual / full sync: enqueue even when auto-sync is off. */
  ignoreAutoSync?: boolean
  /** Enqueue a BullMQ job after the outbox row is written. Default true. */
  dispatch?: boolean
  /**
   * When Redis is down, process this single outbox row inline.
   * Full sync must pass false and use its own 1–2 product budget.
   */
  inlineFallback?: boolean
  /** Stale-variant delete: coalesce separately from a product-level delete. */
  variantOnly?: boolean
}

interface OutboxRow {
  id: string
  account_id: string
  product_id: string | null
  collection_id: string | null
  op: CatalogSyncOp
  status: CatalogSyncStatus
  retailer_ids: string[] | null
  payload: CatalogSetOutboxPayload | null
  coalesce_key: string
  attempts: number
  last_error: string | null
  claimed_at: string | null
  created_at: string
  updated_at: string
}

const OUTBOX_SELECT =
  'id, account_id, product_id, collection_id, op, status, retailer_ids, payload, coalesce_key, attempts, last_error, claimed_at, created_at, updated_at'

export function upsertCoalesceKey(productId: string): string {
  return `upsert:${productId}`
}

export function deleteCoalesceKey(
  productId: string,
  variantOnly = false,
): string {
  return variantOnly ? `delete:${productId}:stale` : `delete:${productId}`
}

export function setCoalesceKey(collectionId: string): string {
  return `set:${collectionId}`
}

export function isCatalogSetOp(op: CatalogSyncOp): boolean {
  return op === 'set_upsert' || op === 'set_delete'
}

export function uniqueRetailerIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export async function enqueueCatalogProductUpsert(
  db: SupabaseClient,
  accountId: string,
  productId: string,
  retailerIds: string[],
  options: EnqueueCatalogSyncOptions = {},
): Promise<string | null> {
  const allowed = await shouldEnqueue(db, accountId, options)
  if (!allowed) return null
  const ids = uniqueRetailerIds(retailerIds)
  const outboxId = await persistOutboxEvent(db, {
    accountId,
    productId,
    op: 'upsert',
    retailerIds: ids,
    coalesceKey: upsertCoalesceKey(productId),
    variantOnly: false,
  })
  if (!outboxId) return null
  await dispatchOutboxJob(accountId, outboxId, options)
  return outboxId
}

export async function enqueueCatalogProductDelete(
  db: SupabaseClient,
  accountId: string,
  productId: string | null,
  retailerIds: string[],
  options: EnqueueCatalogSyncOptions = {},
): Promise<string | null> {
  const allowed = await shouldEnqueue(db, accountId, options)
  if (!allowed) return null
  const ids = uniqueRetailerIds(retailerIds)
  if (ids.length === 0) return null
  const key = productId
    ? deleteCoalesceKey(productId, options.variantOnly === true)
    : `delete:${ids.slice().sort().join(',')}`
  const outboxId = await persistOutboxEvent(db, {
    accountId,
    productId,
    op: 'delete',
    retailerIds: ids,
    coalesceKey: key,
    variantOnly: options.variantOnly === true,
  })
  if (!outboxId) return null
  await dispatchOutboxJob(accountId, outboxId, options)
  return outboxId
}

export async function enqueueCatalogSetUpsert(
  db: SupabaseClient,
  accountId: string,
  collectionId: string,
  options: EnqueueCatalogSyncOptions & { previousTitle?: string | null } = {},
): Promise<string | null> {
  const id = collectionId.trim()
  if (!id) return null
  const allowed = await shouldEnqueue(db, accountId, options)
  if (!allowed) return null
  const previousTitle = options.previousTitle?.trim() || null
  const outboxId = await persistOutboxEvent(db, {
    accountId,
    productId: null,
    collectionId: id,
    op: 'set_upsert',
    retailerIds: [],
    coalesceKey: setCoalesceKey(id),
    variantOnly: false,
    payload: previousTitle ? { previousTitle } : {},
  })
  if (!outboxId) return null
  await dispatchOutboxJob(accountId, outboxId, options)
  return outboxId
}

export async function enqueueCatalogSetUpserts(
  db: SupabaseClient,
  accountId: string,
  collectionIds: string[],
  options: EnqueueCatalogSyncOptions = {},
): Promise<void> {
  const ids = [...new Set(collectionIds.map((id) => id.trim()).filter(Boolean))]
  for (const id of ids) {
    await enqueueCatalogSetUpsert(db, accountId, id, options)
  }
}

export async function enqueueCatalogSetDelete(
  db: SupabaseClient,
  accountId: string,
  input: {
    collectionId: string
    title?: string | null
    metaProductSetId?: string | null
  },
  options: EnqueueCatalogSyncOptions = {},
): Promise<string | null> {
  const id = input.collectionId.trim()
  if (!id) return null
  const allowed = await shouldEnqueue(db, accountId, options)
  if (!allowed) return null
  const outboxId = await persistOutboxEvent(db, {
    accountId,
    productId: null,
    collectionId: id,
    op: 'set_delete',
    retailerIds: [],
    coalesceKey: setCoalesceKey(id),
    variantOnly: false,
    payload: {
      title: input.title ?? null,
      metaProductSetId: input.metaProductSetId ?? null,
    },
  })
  if (!outboxId) return null
  await dispatchOutboxJob(accountId, outboxId, options)
  return outboxId
}

export async function hasPendingProductCatalogSync(
  db: SupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<boolean> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length === 0) return false
  const { data, error } = await db
    .from('catalog_sync_outbox')
    .select('id')
    .eq('account_id', accountId)
    .in('product_id', ids)
    .in('op', ['upsert', 'delete'])
    .in('status', ['pending', 'processing'])
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return Boolean(data?.id)
}

export async function claimCatalogSyncOutbox(
  db: SupabaseClient,
  accountId: string,
  outboxId: string,
  opts: { staleAfterMs?: number } = {},
): Promise<CatalogSyncOutboxRow | null> {
  const { data, error } = await db
    .from('catalog_sync_outbox')
    .select(OUTBOX_SELECT)
    .eq('id', outboxId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = mapOutbox(data as OutboxRow)
  if (row.accountId !== accountId) {
    throw new Error('catalog-meta-sync account mismatch')
  }
  if (row.status === 'succeeded') return null
  if (row.status === 'failed') return null

  const staleAfter = opts.staleAfterMs ?? CATALOG_SYNC_CLAIM_STALE_MS
  if (row.status === 'processing' && !isClaimStale(row.claimedAt, staleAfter)) {
    return row
  }

  const now = new Date().toISOString()
  const { data: claimed, error: claimErr } = await db
    .from('catalog_sync_outbox')
    .update({
      status: 'processing',
      attempts: row.attempts + 1,
      claimed_at: now,
      updated_at: now,
    })
    .eq('id', outboxId)
    .eq('account_id', accountId)
    .select(OUTBOX_SELECT)
    .maybeSingle()
  if (claimErr) throw claimErr
  if (!claimed) return null
  return mapOutbox(claimed as OutboxRow)
}

export async function markCatalogSyncOutboxSucceeded(
  db: SupabaseClient,
  accountId: string,
  outboxId: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from('catalog_sync_outbox')
    .update({
      status: 'succeeded',
      last_error: null,
      updated_at: now,
    })
    .eq('id', outboxId)
    .eq('account_id', accountId)
  if (error) throw error
}

export async function markCatalogSyncOutboxFailed(
  db: SupabaseClient,
  accountId: string,
  outboxId: string,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from('catalog_sync_outbox')
    .update({
      status: 'failed',
      last_error: lastError.slice(0, 2000),
      updated_at: now,
    })
    .eq('id', outboxId)
    .eq('account_id', accountId)
  if (error) throw error
}

export async function markCatalogSyncOutboxPending(
  db: SupabaseClient,
  accountId: string,
  outboxId: string,
  lastError: string,
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await db
    .from('catalog_sync_outbox')
    .update({
      status: 'pending',
      last_error: lastError.slice(0, 2000),
      claimed_at: null,
      updated_at: now,
    })
    .eq('id', outboxId)
    .eq('account_id', accountId)
  if (error) throw error
}

async function shouldEnqueue(
  db: SupabaseClient,
  accountId: string,
  options: EnqueueCatalogSyncOptions,
): Promise<boolean> {
  const settings = await loadCommerceSettings(db, accountId)
  if (commerceMetaCatalogIds(settings).length === 0) return false
  if (options.ignoreAutoSync) return true
  return settings.metaCatalogAutoSync === true
}

async function persistOutboxEvent(
  db: SupabaseClient,
  input: {
    accountId: string
    productId: string | null
    collectionId?: string | null
    op: CatalogSyncOp
    retailerIds: string[]
    coalesceKey: string
    variantOnly: boolean
    payload?: CatalogSetOutboxPayload
  },
): Promise<string | null> {
  const pendingKeys = pendingLookupKeys(input)

  const pending = await findPending(db, input.accountId, [...new Set(pendingKeys)])
  if (pending) {
    const next = coalescePending(pending, input)
    const now = new Date().toISOString()
    const { error } = await db
      .from('catalog_sync_outbox')
      .update({
        op: next.op,
        coalesce_key: next.coalesceKey,
        product_id: input.productId,
        collection_id: input.collectionId ?? null,
        retailer_ids: next.retailerIds,
        payload: next.payload,
        last_error: null,
        updated_at: now,
      })
      .eq('id', pending.id)
      .eq('account_id', input.accountId)
      .eq('status', 'pending')
    if (error) throw error
    return pending.id
  }

  const now = new Date().toISOString()
  const { data, error } = await db
    .from('catalog_sync_outbox')
    .insert({
      account_id: input.accountId,
      product_id: input.productId,
      collection_id: input.collectionId ?? null,
      op: input.op,
      status: 'pending',
      retailer_ids: input.retailerIds,
      payload: input.payload ?? {},
      coalesce_key: input.coalesceKey,
      attempts: 0,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (isUniqueViolation(error)) {
      const raced = await findPending(db, input.accountId, [input.coalesceKey])
      if (raced) return raced.id
    }
    throw error
  }
  return data?.id ? String(data.id) : null
}

function pendingLookupKeys(input: {
  productId: string | null
  op: CatalogSyncOp
  coalesceKey: string
  variantOnly: boolean
}): string[] {
  if (isCatalogSetOp(input.op)) return [input.coalesceKey]
  if (!input.productId) return [input.coalesceKey]
  if (input.op === 'delete' && input.variantOnly) {
    return [input.coalesceKey]
  }
  if (input.op === 'delete') {
    return [
      upsertCoalesceKey(input.productId),
      deleteCoalesceKey(input.productId, false),
    ]
  }
  return [upsertCoalesceKey(input.productId), deleteCoalesceKey(input.productId, false)]
}

function coalescePending(
  pending: CatalogSyncOutboxRow,
  incoming: {
    op: CatalogSyncOp
    retailerIds: string[]
    coalesceKey: string
    productId: string | null
    payload?: CatalogSetOutboxPayload
  },
): {
  op: CatalogSyncOp
  coalesceKey: string
  retailerIds: string[]
  payload: CatalogSetOutboxPayload
} {
  if (isCatalogSetOp(incoming.op) || isCatalogSetOp(pending.op)) {
    return {
      op: incoming.op,
      coalesceKey: incoming.coalesceKey,
      retailerIds: [],
      payload: incoming.payload ?? {},
    }
  }
  if (incoming.op === 'delete' && pending.op === 'upsert') {
    return {
      op: 'delete',
      coalesceKey: incoming.coalesceKey,
      retailerIds: uniqueRetailerIds([
        ...pending.retailerIds,
        ...incoming.retailerIds,
      ]),
      payload: {},
    }
  }
  if (incoming.op === 'upsert' && pending.op === 'delete') {
    return {
      op: 'upsert',
      coalesceKey: incoming.coalesceKey,
      retailerIds: incoming.retailerIds,
      payload: {},
    }
  }
  if (incoming.op === 'delete' && pending.op === 'delete') {
    return {
      op: 'delete',
      coalesceKey: incoming.coalesceKey,
      retailerIds: uniqueRetailerIds([
        ...pending.retailerIds,
        ...incoming.retailerIds,
      ]),
      payload: {},
    }
  }
  return {
    op: incoming.op,
    coalesceKey: incoming.coalesceKey,
    retailerIds: incoming.retailerIds,
    payload: incoming.payload ?? {},
  }
}

async function findPending(
  db: SupabaseClient,
  accountId: string,
  coalesceKeys: string[],
): Promise<CatalogSyncOutboxRow | null> {
  const keys = [...new Set(coalesceKeys.filter(Boolean))]
  if (keys.length === 0) return null
  const { data, error } = await db
    .from('catalog_sync_outbox')
    .select(OUTBOX_SELECT)
    .eq('account_id', accountId)
    .eq('status', 'pending')
    .in('coalesce_key', keys)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? mapOutbox(data as OutboxRow) : null
}

async function dispatchOutboxJob(
  accountId: string,
  outboxId: string,
  options: EnqueueCatalogSyncOptions,
): Promise<void> {
  if (options.dispatch === false) return
  const queued = await enqueueCatalogMetaSync({ accountId, outboxId })
  if (queued || options.inlineFallback === false) return
  try {
    const { processCatalogMetaSync } = await import(
      '@/lib/queue/processors/catalog-meta-sync'
    )
    await processCatalogMetaSync({ accountId, outboxId })
  } catch (err) {
    console.warn('[catalog-sync] inline fallback failed:', err)
  }
}

export function isClaimStale(
  claimedAt: string | null,
  staleAfterMs: number,
): boolean {
  if (!claimedAt) return true
  const ts = Date.parse(claimedAt)
  if (!Number.isFinite(ts)) return true
  return Date.now() - ts >= staleAfterMs
}

function mapOutbox(row: OutboxRow): CatalogSyncOutboxRow {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    productId: row.product_id ? String(row.product_id) : null,
    collectionId: row.collection_id ? String(row.collection_id) : null,
    op: parseOp(row.op),
    status: parseStatus(row.status),
    retailerIds: uniqueRetailerIds(row.retailer_ids ?? []),
    payload: parsePayload(row.payload),
    coalesceKey: row.coalesce_key,
    attempts: Number(row.attempts ?? 0) || 0,
    lastError: row.last_error,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function parseOp(raw: string): CatalogSyncOp {
  if (raw === 'delete' || raw === 'set_upsert' || raw === 'set_delete') return raw
  return 'upsert'
}

function parsePayload(raw: CatalogSetOutboxPayload | null): CatalogSetOutboxPayload {
  if (!raw || typeof raw !== 'object') return {}
  return {
    title: raw.title ?? null,
    previousTitle: raw.previousTitle ?? null,
    metaProductSetId: raw.metaProductSetId ?? null,
  }
}

function parseStatus(raw: string): CatalogSyncStatus {
  if (raw === 'processing' || raw === 'succeeded' || raw === 'failed') return raw
  return 'pending'
}

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '23505' ||
    /duplicate key|unique constraint/i.test(error.message ?? '')
  )
}
