import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { CatalogWriteError } from '../http-write'

const enqueueCatalogSetUpsert = vi.fn()
const enqueueCatalogSetDelete = vi.fn()
const enqueueCatalogSetUpserts = vi.fn()

vi.mock('@/lib/catalog/sync/outbox', () => ({
  enqueueCatalogSetUpsert: (...args: unknown[]) => enqueueCatalogSetUpsert(...args),
  enqueueCatalogSetDelete: (...args: unknown[]) => enqueueCatalogSetDelete(...args),
  enqueueCatalogSetUpserts: (...args: unknown[]) => enqueueCatalogSetUpserts(...args),
}))

import {
  deleteCollection,
  upsertCollection,
} from './commands'
import {
  getCollectionById,
  listCollectionsByAccount,
  listProductsByAccount,
} from './repository'

function seedProducts(
  extra: Record<string, Record<string, unknown>[]> = {},
) {
  return createCatalogMemoryDb({
    catalog_products: [
      {
        id: 'prod-a',
        account_id: 'acct-a',
        handle: 'red-bag',
        title: 'Red bag',
        status: 'active',
      },
      {
        id: 'prod-archived',
        account_id: 'acct-a',
        handle: 'old-bag',
        title: 'Old bag',
        status: 'archived',
      },
      {
        id: 'prod-b',
        account_id: 'acct-b',
        handle: 'blue-bag',
        title: 'Blue bag',
        status: 'active',
      },
    ],
    catalog_variants: [
      {
        id: 'var-a',
        account_id: 'acct-a',
        product_id: 'prod-a',
        retailer_id: 'BAG-RED',
      },
      {
        id: 'var-archived',
        account_id: 'acct-a',
        product_id: 'prod-archived',
        retailer_id: 'BAG-OLD',
      },
      {
        id: 'var-b',
        account_id: 'acct-b',
        product_id: 'prod-b',
        retailer_id: 'BAG-BLUE',
      },
    ],
    ...extra,
  })
}

beforeEach(() => {
  enqueueCatalogSetUpsert.mockReset()
  enqueueCatalogSetDelete.mockReset()
  enqueueCatalogSetUpserts.mockReset()
})

describe('catalog product sets', () => {
  it('creates a set and assigns products', async () => {
    const db = seedProducts()
    const set = await upsertCollection(db, {
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
      productIds: ['prod-a', 'prod-archived'],
    })
    expect(set?.title).toBe('Sarees')
    expect(set?.productIds).toEqual(['prod-a', 'prod-archived'])
    expect(set?.productCount).toBe(2)
    expect(enqueueCatalogSetUpsert).toHaveBeenCalled()

    const listed = await listCollectionsByAccount(db, 'acct-a')
    expect(listed).toEqual([
      expect.objectContaining({
        handle: 'sarees',
        productCount: 2,
      }),
    ])
  })

  it('rejects a duplicate handle on the same account', async () => {
    const db = seedProducts()
    await upsertCollection(db, {
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
    })
    await expect(
      upsertCollection(db, {
        accountId: 'acct-a',
        handle: 'sarees',
        title: 'Sarees 2',
      }),
    ).rejects.toBeInstanceOf(CatalogWriteError)
  })

  it('keeps handles unique per account, not globally', async () => {
    const db = seedProducts()
    await upsertCollection(db, {
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees A',
    })
    const other = await upsertCollection(db, {
      accountId: 'acct-b',
      handle: 'sarees',
      title: 'Sarees B',
    })
    expect(other?.accountId).toBe('acct-b')
    expect(other?.handle).toBe('sarees')
  })

  it('does not let another account read or delete a set', async () => {
    const db = seedProducts()
    const set = await upsertCollection(db, {
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
    })
    expect(await getCollectionById(db, 'acct-b', set!.id)).toBeNull()
    expect(await deleteCollection(db, 'acct-b', set!.id)).toBe(false)
    expect(await getCollectionById(db, 'acct-a', set!.id)).not.toBeNull()
  })

  it('rejects product ids from another account', async () => {
    const db = seedProducts()
    await expect(
      upsertCollection(db, {
        accountId: 'acct-a',
        handle: 'mixed',
        title: 'Mixed',
        productIds: ['prod-a', 'prod-b'],
      }),
    ).rejects.toBeInstanceOf(CatalogWriteError)
  })

  it('keeps the local set when Meta publish throws', async () => {
    enqueueCatalogSetUpsert.mockRejectedValue(new Error('graph down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const db = seedProducts()
    const set = await upsertCollection(db, {
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
    })
    expect(set?.title).toBe('Sarees')
    expect(await getCollectionById(db, 'acct-a', set!.id)).not.toBeNull()
    warn.mockRestore()
  })

  it('lists only products in a collection', async () => {
    const db = seedProducts({
      catalog_collections: [
        {
          id: 'col-1',
          account_id: 'acct-a',
          handle: 'sarees',
          title: 'Sarees',
          status: 'active',
        },
      ],
      catalog_product_collections: [
        {
          id: 'join-1',
          account_id: 'acct-a',
          product_id: 'prod-a',
          collection_id: 'col-1',
          sort_order: 0,
        },
      ],
    })
    const listed = await listProductsByAccount(db, {
      accountId: 'acct-a',
      collectionId: 'col-1',
    })
    expect(listed.map((product) => product.id)).toEqual(['prod-a'])
  })

  it('returns no products for an empty collection', async () => {
    const db = seedProducts({
      catalog_collections: [
        {
          id: 'col-empty',
          account_id: 'acct-a',
          handle: 'offers',
          title: 'Offers',
          status: 'active',
        },
      ],
    })
    const listed = await listProductsByAccount(db, {
      accountId: 'acct-a',
      collectionId: 'col-empty',
    })
    expect(listed).toEqual([])
  })

  it('clears the Meta set when the local set is deleted', async () => {
    const db = seedProducts({
      catalog_collections: [
        {
          id: 'col-1',
          account_id: 'acct-a',
          handle: 'sarees',
          title: 'Sarees',
          status: 'active',
          meta_product_set_id: 'ps-1',
        },
      ],
    })
    expect(await deleteCollection(db, 'acct-a', 'col-1')).toBe(true)
    expect(enqueueCatalogSetDelete).toHaveBeenCalledWith(
      db,
      'acct-a',
      expect.objectContaining({
        collectionId: 'col-1',
        title: 'Sarees',
        metaProductSetId: 'ps-1',
      }),
    )
    expect(await getCollectionById(db, 'acct-a', 'col-1')).toBeNull()
  })
})
