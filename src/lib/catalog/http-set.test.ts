import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from './search/memory-db'
import { CatalogWriteError } from './http-write'
import { buildCatalogSetDraft, catalogSetToJson } from './http-set'

describe('buildCatalogSetDraft', () => {
  it('slugifies the handle and requires a title', async () => {
    const db = createCatalogMemoryDb()
    await expect(
      buildCatalogSetDraft(db, { accountId: 'acct-a', input: {} }),
    ).rejects.toBeInstanceOf(CatalogWriteError)

    const draft = await buildCatalogSetDraft(db, {
      accountId: 'acct-a',
      input: { title: 'Festive Sarees' },
    })
    expect(draft.handle).toBe('festive-sarees')
    expect(draft.status).toBe('active')
  })

  it('rejects product ids that do not belong to the account', async () => {
    const db = createCatalogMemoryDb({
      catalog_products: [
        { id: 'prod-a', account_id: 'acct-a', handle: 'a', title: 'A', status: 'active' },
      ],
    })
    await expect(
      buildCatalogSetDraft(db, {
        accountId: 'acct-a',
        input: { title: 'Set', productIds: ['prod-a', 'prod-other'] },
      }),
    ).rejects.toBeInstanceOf(CatalogWriteError)
  })
})

describe('catalogSetToJson', () => {
  it('exposes Meta sync status', () => {
    expect(
      catalogSetToJson({
        id: 'col-1',
        accountId: 'acct-a',
        handle: 'sarees',
        title: 'Sarees',
        status: 'active',
        metaProductSetId: 'ps-1',
        metaCollectionReview: 'pending',
        productCount: 2,
      }),
    ).toEqual(
      expect.objectContaining({
        metaProductSetId: 'ps-1',
        metaSynced: true,
        metaCollectionReview: 'pending',
        productCount: 2,
      }),
    )
  })
})
