import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogProduct } from '@/lib/catalog/core/types'
import { MetaCatalogGraphError } from '@/lib/shopify/meta-catalog-sync'

const claimCatalogSyncOutbox = vi.fn()
const markCatalogSyncOutboxSucceeded = vi.fn()
const markCatalogSyncOutboxFailed = vi.fn()
const markCatalogSyncOutboxPending = vi.fn()
const hasPendingProductCatalogSync = vi.fn()
const getProductById = vi.fn()
const getCollectionById = vi.fn()
const listProductIdsForCollection = vi.fn()
const publishCatalogSetToMeta = vi.fn()
const deleteCatalogSetOnMeta = vi.fn()
const upsertMetaCatalogItems = vi.fn()
const deleteMetaCatalogItems = vi.fn()
const loadWhatsAppAccessToken = vi.fn()
const loadCommerceSettings = vi.fn()
const explainMetaCatalogSyncError = vi.fn(
  (opts: { graphMessage: string }) => opts.graphMessage,
)
const listWabaProductCatalogs = vi.fn().mockResolvedValue({
  status: 'ok',
  catalogs: [],
})
const catalogIdLooksLikeWhatsAppAsset = vi.fn().mockReturnValue(null)
const supabaseFrom = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ from: supabaseFrom }),
}))

vi.mock('@/lib/catalog/sync/outbox', async () => {
  const actual = await vi.importActual<typeof import('@/lib/catalog/sync/outbox')>(
    '@/lib/catalog/sync/outbox',
  )
  return {
    ...actual,
    claimCatalogSyncOutbox: (...args: unknown[]) => claimCatalogSyncOutbox(...args),
    markCatalogSyncOutboxSucceeded: (...args: unknown[]) =>
      markCatalogSyncOutboxSucceeded(...args),
    markCatalogSyncOutboxFailed: (...args: unknown[]) =>
      markCatalogSyncOutboxFailed(...args),
    markCatalogSyncOutboxPending: (...args: unknown[]) =>
      markCatalogSyncOutboxPending(...args),
    hasPendingProductCatalogSync: (...args: unknown[]) =>
      hasPendingProductCatalogSync(...args),
  }
})

vi.mock('@/lib/catalog/core/repository', () => ({
  getProductById: (...args: unknown[]) => getProductById(...args),
  getCollectionById: (...args: unknown[]) => getCollectionById(...args),
  listProductIdsForCollection: (...args: unknown[]) =>
    listProductIdsForCollection(...args),
}))

vi.mock('@/lib/catalog/sync/product-sets', () => ({
  publishCatalogSetToMeta: (...args: unknown[]) => publishCatalogSetToMeta(...args),
  deleteCatalogSetOnMeta: (...args: unknown[]) => deleteCatalogSetOnMeta(...args),
}))

vi.mock('@/lib/shopify/commerce-config', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/shopify/commerce-config')
  >('@/lib/shopify/commerce-config')
  return {
    ...actual,
    loadCommerceSettings: (...args: unknown[]) => loadCommerceSettings(...args),
  }
})

vi.mock('@/lib/shopify/meta-catalog-sync', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/shopify/meta-catalog-sync')
  >('@/lib/shopify/meta-catalog-sync')
  return {
    ...actual,
    upsertMetaCatalogItems: (...args: unknown[]) => upsertMetaCatalogItems(...args),
    deleteMetaCatalogItems: (...args: unknown[]) => deleteMetaCatalogItems(...args),
    loadWhatsAppAccessToken: (...args: unknown[]) =>
      loadWhatsAppAccessToken(...args),
    explainMetaCatalogSyncError: (...args: unknown[]) =>
      explainMetaCatalogSyncError(...(args as [never])),
    listWabaProductCatalogs: (...args: unknown[]) =>
      listWabaProductCatalogs(...args),
    catalogIdLooksLikeWhatsAppAsset: (...args: unknown[]) =>
      catalogIdLooksLikeWhatsAppAsset(...args),
  }
})

import { processCatalogMetaSync } from './catalog-meta-sync'

function claimed(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    accountId: 'acct-a',
    productId: 'prod-1',
    collectionId: null,
    op: 'upsert' as const,
    status: 'processing' as const,
    retailerIds: ['BAG-RED'],
    payload: {},
    coalesceKey: 'upsert:prod-1',
    attempts: 1,
    lastError: null,
    claimedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function catalogProduct(): CatalogProduct {
  return {
    id: 'prod-1',
    accountId: 'acct-a',
    handle: 'red-bag',
    title: 'Red Bag',
    description: 'Leather tote',
    status: 'active',
    brand: 'Acme',
    productUrl: 'https://shop.example/products/red-bag',
    currency: 'INR',
    priceMin: 49,
    priceMax: 49,
    origin: 'wacrm',
    locked: false,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    variants: [
      {
        id: 'var-1',
        accountId: 'acct-a',
        productId: 'prod-1',
        title: 'Default',
        sku: 'OTHER-SKU',
        price: 49,
        compareAtPrice: null,
        currency: 'INR',
        available: true,
        inventoryQuantity: 2,
        options: [],
        sortOrder: 0,
        retailerId: 'BAG-RED',
      },
    ],
    media: [],
    externalIds: [],
  }
}

describe('processCatalogMetaSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    supabaseFrom.mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({ error: null }),
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    }))
    claimCatalogSyncOutbox.mockResolvedValue(claimed())
    loadCommerceSettings.mockResolvedValue({
      metaCatalogId: 'cat-1',
      metaCatalogIds: ['cat-1'],
      metaCatalogAutoSync: true,
    })
    loadWhatsAppAccessToken.mockResolvedValue({
      token: 'tok',
      phoneNumberId: 'pn',
      wabaId: 'waba',
    })
    getProductById.mockResolvedValue(catalogProduct())
    getCollectionById.mockResolvedValue({
      id: 'col-1',
      accountId: 'acct-a',
      handle: 'sarees',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: 'ps-1',
      productIds: ['prod-1'],
      productCount: 1,
    })
    listProductIdsForCollection.mockResolvedValue(['prod-1'])
    hasPendingProductCatalogSync.mockResolvedValue(false)
    publishCatalogSetToMeta.mockResolvedValue(undefined)
    deleteCatalogSetOnMeta.mockResolvedValue(undefined)
    upsertMetaCatalogItems.mockResolvedValue(undefined)
    deleteMetaCatalogItems.mockResolvedValue(undefined)
    catalogIdLooksLikeWhatsAppAsset.mockReturnValue(null)
  })

  it('upserts mapped catalog items using persisted retailer_id', async () => {
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(upsertMetaCatalogItems).toHaveBeenCalledWith(
      'cat-1',
      'tok',
      [
        expect.objectContaining({
          retailer_id: 'BAG-RED',
          name: 'Red Bag',
        }),
      ],
    )
    expect(markCatalogSyncOutboxSucceeded).toHaveBeenCalled()
    expect(deleteMetaCatalogItems).not.toHaveBeenCalled()
  })

  it('deletes persisted retailer_ids when the product is gone or inactive', async () => {
    getProductById.mockResolvedValue(null)
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(deleteMetaCatalogItems).toHaveBeenCalledWith('cat-1', 'tok', [
      'BAG-RED',
    ])
    expect(upsertMetaCatalogItems).not.toHaveBeenCalled()
    expect(markCatalogSyncOutboxSucceeded).toHaveBeenCalled()
  })

  it('treats delete-not-found as success', async () => {
    claimCatalogSyncOutbox.mockResolvedValue(
      claimed({ op: 'delete', retailerIds: ['GONE'] }),
    )
    deleteMetaCatalogItems.mockRejectedValueOnce(
      new Error('retailer_id GONE does not exist'),
    )
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(markCatalogSyncOutboxSucceeded).toHaveBeenCalled()
    expect(markCatalogSyncOutboxFailed).not.toHaveBeenCalled()
  })

  it('retries Meta 5xx and 429 by reverting to pending and throwing', async () => {
    upsertMetaCatalogItems.mockRejectedValueOnce(
      new MetaCatalogGraphError('server down', 503),
    )
    await expect(
      processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' }),
    ).rejects.toThrow(/server down/)
    expect(markCatalogSyncOutboxPending).toHaveBeenCalled()
    expect(markCatalogSyncOutboxFailed).not.toHaveBeenCalled()

    markCatalogSyncOutboxPending.mockClear()
    upsertMetaCatalogItems.mockRejectedValueOnce(
      new MetaCatalogGraphError('slow down', 429, 15_000),
    )
    await expect(
      processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' }),
    ).rejects.toThrow(/slow down/)
    expect(markCatalogSyncOutboxPending).toHaveBeenCalled()
  })

  it('marks permanent 4xx, missing token, and missing catalog id as failed', async () => {
    upsertMetaCatalogItems.mockRejectedValueOnce(
      new MetaCatalogGraphError('bad token', 400),
    )
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(markCatalogSyncOutboxFailed).toHaveBeenCalled()
    expect(markCatalogSyncOutboxPending).not.toHaveBeenCalled()

    markCatalogSyncOutboxFailed.mockClear()
    loadWhatsAppAccessToken.mockResolvedValueOnce(null)
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(markCatalogSyncOutboxFailed).toHaveBeenCalled()

    markCatalogSyncOutboxFailed.mockClear()
    loadCommerceSettings.mockResolvedValueOnce({
      metaCatalogId: null,
      metaCatalogIds: [],
      metaCatalogAutoSync: true,
    })
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(markCatalogSyncOutboxFailed).toHaveBeenCalled()
    expect(upsertMetaCatalogItems).toHaveBeenCalledTimes(1)
  })

  it('fans out upserts to every selected catalog id', async () => {
    loadCommerceSettings.mockResolvedValueOnce({
      metaCatalogId: 'cat-1',
      metaCatalogIds: ['cat-1', 'cat-2'],
      metaCatalogAutoSync: true,
    })
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(upsertMetaCatalogItems).toHaveBeenCalledTimes(2)
    expect(upsertMetaCatalogItems).toHaveBeenNthCalledWith(
      1,
      'cat-1',
      'tok',
      [expect.objectContaining({ retailer_id: 'BAG-RED' })],
    )
    expect(upsertMetaCatalogItems).toHaveBeenNthCalledWith(
      2,
      'cat-2',
      'tok',
      [expect.objectContaining({ retailer_id: 'BAG-RED' })],
    )
  })

  it('falls back to the single primary catalog id', async () => {
    loadCommerceSettings.mockResolvedValueOnce({
      metaCatalogId: 'cat-legacy',
      metaCatalogIds: [],
      metaCatalogAutoSync: true,
    })
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(upsertMetaCatalogItems).toHaveBeenCalledWith(
      'cat-legacy',
      'tok',
      [expect.objectContaining({ retailer_id: 'BAG-RED' })],
    )
  })

  it('publishes a collection set after member products are synced', async () => {
    claimCatalogSyncOutbox.mockResolvedValue(
      claimed({
        productId: null,
        collectionId: 'col-1',
        op: 'set_upsert',
        retailerIds: [],
        coalesceKey: 'set:col-1',
        payload: { previousTitle: 'Old Sarees' },
      }),
    )
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(publishCatalogSetToMeta).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'col-1', title: 'Sarees' }),
      { ignoreAutoSync: true, previousTitle: 'Old Sarees' },
    )
    expect(upsertMetaCatalogItems).not.toHaveBeenCalled()
    expect(markCatalogSyncOutboxSucceeded).toHaveBeenCalled()
  })

  it('retries set publish when member products are still in the outbox', async () => {
    claimCatalogSyncOutbox.mockResolvedValue(
      claimed({
        productId: null,
        collectionId: 'col-1',
        op: 'set_upsert',
        retailerIds: [],
        coalesceKey: 'set:col-1',
      }),
    )
    hasPendingProductCatalogSync.mockResolvedValueOnce(true)
    await expect(
      processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' }),
    ).rejects.toThrow(/Waiting for product catalog sync/)
    expect(publishCatalogSetToMeta).not.toHaveBeenCalled()
    expect(markCatalogSyncOutboxPending).toHaveBeenCalled()
    expect(markCatalogSyncOutboxFailed).not.toHaveBeenCalled()
  })

  it('deletes the Meta set from a set_delete snapshot after the local row is gone', async () => {
    claimCatalogSyncOutbox.mockResolvedValue(
      claimed({
        productId: null,
        collectionId: null,
        op: 'set_delete',
        retailerIds: [],
        coalesceKey: 'set:col-1',
        payload: { title: 'Sarees', metaProductSetId: 'ps-1' },
      }),
    )
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(deleteCatalogSetOnMeta).toHaveBeenCalledWith(
      expect.anything(),
      'acct-a',
      'ps-1',
      'Sarees',
      undefined,
    )
    expect(publishCatalogSetToMeta).not.toHaveBeenCalled()
    expect(upsertMetaCatalogItems).not.toHaveBeenCalled()
    expect(markCatalogSyncOutboxSucceeded).toHaveBeenCalled()
  })

  it('is a no-op for a succeeded replay and rejects another account', async () => {
    claimCatalogSyncOutbox.mockResolvedValueOnce(null)
    await processCatalogMetaSync({ accountId: 'acct-a', outboxId: 'outbox-1' })
    expect(upsertMetaCatalogItems).not.toHaveBeenCalled()

    claimCatalogSyncOutbox.mockRejectedValueOnce(
      new Error('catalog-meta-sync account mismatch'),
    )
    await expect(
      processCatalogMetaSync({ accountId: 'acct-b', outboxId: 'outbox-1' }),
    ).rejects.toThrow(/account mismatch/)
  })
})
