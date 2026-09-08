import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const enqueueCatalogMetaSync = vi.fn().mockResolvedValue(true)
const processCatalogMetaSync = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueCatalogMetaSync: (...args: unknown[]) => enqueueCatalogMetaSync(...args),
}))

vi.mock('@/lib/queue/processors/catalog-meta-sync', () => ({
  processCatalogMetaSync: (...args: unknown[]) => processCatalogMetaSync(...args),
}))

import {
  claimCatalogSyncOutbox,
  enqueueCatalogProductDelete,
  enqueueCatalogProductUpsert,
  enqueueCatalogSetDelete,
  enqueueCatalogSetUpsert,
  markCatalogSyncOutboxSucceeded,
} from './outbox'
import { enqueueFullCatalogMetaSync } from './full-sync'

function createOutboxDb(opts?: {
  autoSync?: boolean
  catalogId?: string | null
}): SupabaseClient {
  const tables: Record<string, Record<string, unknown>[]> = {
    shopify_configs: [
      {
        account_id: 'acct-a',
        meta_catalog_id: opts?.catalogId === undefined ? 'cat-1' : opts.catalogId,
        meta_catalog_auto_sync: opts?.autoSync !== false,
        retailer_id_source: 'sku',
        last_meta_catalog_sync_at: null,
        meta_catalog_item_count: 0,
      },
    ],
    catalog_sync_outbox: [],
    catalog_products: [
      {
        id: 'prod-1',
        account_id: 'acct-a',
        status: 'active',
      },
      {
        id: 'prod-2',
        account_id: 'acct-a',
        status: 'active',
      },
      {
        id: 'prod-archived',
        account_id: 'acct-a',
        status: 'archived',
      },
    ],
    catalog_variants: [
      { product_id: 'prod-1', account_id: 'acct-a', retailer_id: 'BAG-RED' },
      { product_id: 'prod-2', account_id: 'acct-a', retailer_id: 'BAG-BLUE' },
    ],
  }
  let seq = 1
  const nextId = () => `outbox-${seq++}`

  const from = (table: string) => {
    const rows = () => {
      if (!tables[table]) tables[table] = []
      return tables[table]
    }
    const filters: Array<(row: Record<string, unknown>) => boolean> = []
    let orderKey: string | null = null
    let rangeStart = 0
    let rangeEnd = Number.POSITIVE_INFINITY
    const apply = () => {
      let list = rows().filter((row) => filters.every((fn) => fn(row)))
      if (orderKey) {
        list = [...list].sort((a, b) =>
          String(a[orderKey!] ?? '').localeCompare(String(b[orderKey!] ?? '')),
        )
      }
      return list.slice(rangeStart, rangeEnd + 1)
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      order: (column: string) => {
        orderKey = column
        return builder
      },
      limit: (n: number) => {
        rangeEnd = rangeStart + n - 1
        return builder
      },
      range: (fromIdx: number, toIdx: number) => {
        rangeStart = fromIdx
        rangeEnd = toIdx
        return builder
      },
      eq: (column: string, value: unknown) => {
        filters.push((row) => row[column] === value)
        return builder
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(row[column]))
        return builder
      },
      maybeSingle: async () => ({ data: apply()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Record<string, unknown>[]; error: null }) => void) =>
        resolve({ data: apply(), error: null }),
      insert: (incoming: Record<string, unknown>) => {
        const row = {
          id: nextId(),
          attempts: 0,
          last_error: null,
          claimed_at: null,
          ...incoming,
        }
        rows().push(row)
        const ok = { data: row, error: null }
        return {
          select: () => ({
            maybeSingle: async () => ok,
          }),
        }
      },
      update: (patch: Record<string, unknown>) => {
        const run = () => {
          for (const row of apply()) Object.assign(row, patch)
          return apply()[0] ?? null
        }
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters.push((row) => row[column] === value)
            return chain
          },
          select: () => ({
            maybeSingle: async () => ({ data: run(), error: null }),
          }),
          then: (resolve: (value: { error: null }) => void) => {
            run()
            resolve({ error: null })
          },
        }
        return chain
      },
    }
    return builder
  }

  return { from } as unknown as SupabaseClient
}

describe('catalog sync outbox', () => {
  beforeEach(() => {
    enqueueCatalogMetaSync.mockReset().mockResolvedValue(true)
    processCatalogMetaSync.mockReset().mockResolvedValue(undefined)
  })

  it('does not enqueue when auto-sync is off or catalog id is missing', async () => {
    const off = createOutboxDb({ autoSync: false })
    expect(
      await enqueueCatalogProductUpsert(off, 'acct-a', 'prod-1', ['BAG-RED']),
    ).toBeNull()
    const missing = createOutboxDb({ catalogId: null })
    expect(
      await enqueueCatalogProductUpsert(missing, 'acct-a', 'prod-1', ['BAG-RED']),
    ).toBeNull()
    expect(enqueueCatalogMetaSync).not.toHaveBeenCalled()
  })

  it('coalesces rapid pending upserts for the same product', async () => {
    const db = createOutboxDb()
    const first = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    const second = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
      'BAG-XL',
    ])
    expect(first).toBe(second)
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(1)
    expect(data?.[0]?.retailer_ids).toEqual(['BAG-RED', 'BAG-XL'])
    expect(data?.[0]?.op).toBe('upsert')
  })

  it('replaces a pending upsert with delete', async () => {
    const db = createOutboxDb()
    const upsertId = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    const deleteId = await enqueueCatalogProductDelete(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    expect(deleteId).toBe(upsertId)
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(1)
    expect(data?.[0]?.op).toBe('delete')
    expect(data?.[0]?.retailer_ids).toEqual(['BAG-RED'])
  })

  it('does not overwrite a processing row; inserts a new pending event', async () => {
    const db = createOutboxDb()
    const first = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    await claimCatalogSyncOutbox(db, 'acct-a', first!)
    const second = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED-2',
    ])
    expect(second).not.toBe(first)
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(2)
    expect(data?.map((row) => row.status).sort()).toEqual(['pending', 'processing'])
  })

  it('keeps stale-variant deletes separate from a pending upsert', async () => {
    const db = createOutboxDb()
    await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', ['BAG-RED'])
    await enqueueCatalogProductDelete(db, 'acct-a', 'prod-1', ['OLD-SKU'], {
      variantOnly: true,
    })
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(2)
    expect(data?.map((row) => row.op).sort()).toEqual(['delete', 'upsert'])
  })

  it('reclaims a stale processing row and skips a succeeded replay', async () => {
    const db = createOutboxDb()
    const id = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    const claimed = await claimCatalogSyncOutbox(db, 'acct-a', id!, {
      staleAfterMs: 0,
    })
    expect(claimed?.status).toBe('processing')
    expect(claimed?.attempts).toBe(1)
    await markCatalogSyncOutboxSucceeded(db, 'acct-a', id!)
    expect(await claimCatalogSyncOutbox(db, 'acct-a', id!)).toBeNull()
  })

  it('rejects claiming another account outbox id', async () => {
    const db = createOutboxDb()
    const id = await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', [
      'BAG-RED',
    ])
    await expect(claimCatalogSyncOutbox(db, 'acct-b', id!)).rejects.toThrow(
      /account mismatch/,
    )
  })

  it('falls back inline when Redis enqueue fails', async () => {
    enqueueCatalogMetaSync.mockResolvedValueOnce(false)
    const db = createOutboxDb()
    await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', ['BAG-RED'])
    expect(processCatalogMetaSync).toHaveBeenCalledWith({
      accountId: 'acct-a',
      outboxId: 'outbox-1',
    })
  })

  it('enqueues a full sync of active products only and ignores auto-sync', async () => {
    const db = createOutboxDb({ autoSync: false })
    const result = await enqueueFullCatalogMetaSync(db, 'acct-a')
    expect(result.queued).toBe(2)
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(2)
    expect(data?.every((row) => row.op === 'upsert')).toBe(true)
    expect(enqueueCatalogMetaSync).toHaveBeenCalledTimes(2)
  })

  it('limits inline Graph work on full sync when Redis is down', async () => {
    enqueueCatalogMetaSync.mockResolvedValue(false)
    const db = createOutboxDb()
    await enqueueFullCatalogMetaSync(db, 'acct-a')
    expect(processCatalogMetaSync).toHaveBeenCalledTimes(2)
  })

  it('enqueues and coalesces collection set events separately from products', async () => {
    const db = createOutboxDb()
    const first = await enqueueCatalogSetUpsert(db, 'acct-a', 'col-1', {
      previousTitle: 'Old',
    })
    const second = await enqueueCatalogSetUpsert(db, 'acct-a', 'col-1')
    expect(first).toBe(second)
    await enqueueCatalogProductUpsert(db, 'acct-a', 'prod-1', ['BAG-RED'])
    const deleted = await enqueueCatalogSetDelete(db, 'acct-a', {
      collectionId: 'col-1',
      title: 'Sarees',
      metaProductSetId: 'ps-1',
    })
    expect(deleted).toBe(first)
    const { data } = await db
      .from('catalog_sync_outbox')
      .select('*')
      .eq('account_id', 'acct-a')
    expect(data).toHaveLength(2)
    const setRow = data?.find((row) => row.op === 'set_delete')
    const productRow = data?.find((row) => row.op === 'upsert')
    expect(setRow?.coalesce_key).toBe('set:col-1')
    expect(setRow?.payload).toEqual({
      title: 'Sarees',
      metaProductSetId: 'ps-1',
    })
    expect(productRow?.coalesce_key).toBe('upsert:prod-1')
  })
})
