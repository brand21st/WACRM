import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { encrypt } from '@/lib/whatsapp/encryption'
import { metaProductSetFilter } from '@/lib/shopify/meta-catalog-sync'
import {
  deleteCatalogSetOnMeta,
  publishAllCatalogSetsToMeta,
  publishCatalogSetToMeta,
} from './product-sets'

function seedDb(
  extra: Record<string, Record<string, unknown>[]> = {},
) {
  return createCatalogMemoryDb({
    shopify_configs: [
      {
        account_id: 'acct-a',
        meta_catalog_id: 'meta-cat',
        meta_catalog_auto_sync: true,
      },
    ],
    whatsapp_config: [
      {
        account_id: 'acct-a',
        access_token: encrypt('wa-token'),
        phone_number_id: 'pn',
        waba_id: 'waba',
      },
    ],
    catalog_collections: [
      {
        id: 'col-1',
        account_id: 'acct-a',
        handle: 'sarees',
        title: 'Sarees',
        status: 'active',
        meta_product_set_id: null,
      },
    ],
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
    catalog_media: [
      {
        id: 'media-a',
        account_id: 'acct-a',
        product_id: 'prod-a',
        url: 'https://cdn.example/saree.jpg',
        role: 'hero',
        sort_order: 0,
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
      {
        id: 'join-2',
        account_id: 'acct-a',
        product_id: 'prod-archived',
        collection_id: 'col-1',
        sort_order: 1,
      },
    ],
    ...extra,
  })
}

function mockGraph(payload: unknown = { id: 'ps-99' }, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
    headers: { get: () => null },
  })
}

function productSetWriteCall(fetchMock: ReturnType<typeof vi.fn>) {
  const match = fetchMock.mock.calls.find((call) => {
    const init = call[1] as RequestInit | undefined
    return Boolean(init?.body) && init?.method !== 'DELETE'
  })
  return match as [string, RequestInit] | undefined
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('catalog set Meta sync', () => {
  it('sends only this account’s active retailer ids', async () => {
    const fetchMock = mockGraph({ id: 'ps-99' })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    const write = productSetWriteCall(fetchMock)
    expect(write).toBeTruthy()
    const [url, init] = write!
    expect(url).toContain('/meta-cat/product_sets')
    expect(init.method).toBe('POST')
    const body = JSON.parse(String(init.body))
    expect(body.name).toBe('Sarees')
    expect(body.metadata).toEqual({
      description: 'Sarees',
      cover_image_url: 'https://cdn.example/saree.jpg',
    })
    expect(JSON.parse(body.filter)).toEqual(
      metaProductSetFilter(['BAG-RED']),
    )
    expect(body.filter).not.toContain('BAG-OLD')
    expect(body.filter).not.toContain('BAG-BLUE')
    const { data } = await db
      .from('catalog_collections')
      .select('meta_product_set_id')
      .eq('id', 'col-1')
      .maybeSingle()
    expect(data?.meta_product_set_id).toBe('ps-99')
  })

  it('keeps the local set when Graph throws', async () => {
    vi.stubGlobal('fetch', mockGraph({ error: { message: 'graph 500' } }, false))
    const db = seedDb()
    await expect(
      publishCatalogSetToMeta(db, {
        id: 'col-1',
        accountId: 'acct-a',
        title: 'Sarees',
        status: 'active',
        metaProductSetId: null,
      }),
    ).rejects.toThrow(/graph 500|Meta product set/)
    const { data } = await db
      .from('catalog_collections')
      .select('title, meta_product_set_id')
      .eq('id', 'col-1')
      .maybeSingle()
    expect(data?.title).toBe('Sarees')
    expect(data?.meta_product_set_id).toBeNull()
  })

  it('reuses a Meta set when create fails because the filter already exists', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const href = String(url)
      const method = init?.method ?? 'GET'
      if (href.includes('/product_sets') && method === 'POST' && init?.body) {
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: { message: 'Product set with the same filters already exists' },
          }),
          headers: { get: () => null },
        }
      }
      if (href.includes('/product_sets?fields=')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: 'ps-existing',
                name: 'Old heading',
                filter: { retailer_id: { is_any: ['BAG-RED'] } },
              },
            ],
          }),
          headers: { get: () => null },
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'ps-existing' }),
        headers: { get: () => null },
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    const update = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes('/ps-existing'),
    )
    expect(update).toBeTruthy()
    const { data } = await db
      .from('catalog_collections')
      .select('meta_product_set_id')
      .eq('id', 'col-1')
      .maybeSingle()
    expect(data?.meta_product_set_id).toBe('ps-existing')
  })

  it('does not create a Meta set when the collection has no active retailer ids', async () => {
    const fetchMock = mockGraph({ id: 'ps-99' })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      catalog_product_collections: [],
    })
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('finds a renamed set on a secondary catalog by the previous title', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const href = String(url)
      const body = href.includes('/meta-cat-2/product_sets?fields=')
        ? { data: [{ id: 'ps-old', name: 'Old Sarees' }] }
        : { id: 'ps-99' }
      return {
        ok: true,
        status: 200,
        json: async () => body,
        headers: { get: () => null },
      }
    })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      shopify_configs: [
        {
          account_id: 'acct-a',
          meta_catalog_id: 'meta-cat',
          meta_catalog_ids: ['meta-cat', 'meta-cat-2'],
          meta_catalog_auto_sync: true,
        },
      ],
    })
    await publishCatalogSetToMeta(
      db,
      {
        id: 'col-1',
        accountId: 'acct-a',
        title: 'Sarees',
        status: 'active',
        metaProductSetId: 'ps-primary',
      },
      { previousTitle: 'Old Sarees' },
    )
    const updateCall = fetchMock.mock.calls.find(
      (call) =>
        String(call[0]).includes('/ps-old') &&
        (call[1] as RequestInit | undefined)?.method === 'POST',
    )
    expect(updateCall).toBeTruthy()
    const body = JSON.parse(String((updateCall?.[1] as RequestInit).body))
    expect(body.name).toBe('Sarees')
  })

  it('skips Graph when auto-sync is off', async () => {
    const fetchMock = mockGraph()
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      shopify_configs: [
        {
          account_id: 'acct-a',
          meta_catalog_id: 'meta-cat',
          meta_catalog_auto_sync: false,
        },
      ],
    })
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes when auto-sync is off if ignoreAutoSync is set', async () => {
    const fetchMock = mockGraph({ id: 'ps-99' })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      shopify_configs: [
        {
          account_id: 'acct-a',
          meta_catalog_id: 'meta-cat',
          meta_catalog_auto_sync: false,
        },
      ],
    })
    await publishAllCatalogSetsToMeta(db, 'acct-a', { ignoreAutoSync: true })
    expect(productSetWriteCall(fetchMock)).toBeTruthy()
  })

  it('skips Graph when no WhatsApp catalog id is saved', async () => {
    const fetchMock = mockGraph()
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      shopify_configs: [{ account_id: 'acct-a', meta_catalog_id: null }],
    })
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes the Meta set when the local set is archived', async () => {
    const fetchMock = mockGraph({})
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'archived',
      metaProductSetId: 'ps-1',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/ps-1')
    expect(init.method).toBe('DELETE')
    const { data } = await db
      .from('catalog_collections')
      .select('meta_product_set_id')
      .eq('id', 'col-1')
      .maybeSingle()
    expect(data?.meta_product_set_id).toBeNull()
  })

  it('does not publish homepage collections to WhatsApp Catalogue', async () => {
    const fetchMock = mockGraph({})
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      handle: 'frontpage',
      title: 'Home page',
      status: 'active',
      metaProductSetId: 'ps-home',
    })
    expect(fetchMock.mock.calls.some((call) => {
      const init = call[1] as RequestInit | undefined
      return init?.method === 'DELETE'
    })).toBe(true)
    expect(productSetWriteCall(fetchMock)).toBeUndefined()
  })

  it('deletes the Meta set by id', async () => {
    const fetchMock = mockGraph({})
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await deleteCatalogSetOnMeta(db, 'acct-a', 'ps-1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/ps-1')
    expect(init.method).toBe('DELETE')
  })

  it('publishes the set to every selected catalog id', async () => {
    const fetchMock = mockGraph({ id: 'ps-99' })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb({
      shopify_configs: [
        {
          account_id: 'acct-a',
          meta_catalog_id: 'meta-cat',
          meta_catalog_ids: ['meta-cat', 'meta-cat-2'],
          meta_catalog_auto_sync: true,
        },
      ],
    })
    await publishCatalogSetToMeta(db, {
      id: 'col-1',
      accountId: 'acct-a',
      title: 'Sarees',
      status: 'active',
      metaProductSetId: null,
    })
    const urls = fetchMock.mock.calls.map((call) => String(call[0]))
    expect(urls.some((url) => url.includes('/meta-cat/product_sets'))).toBe(true)
    expect(urls.some((url) => url.includes('/meta-cat-2/product_sets'))).toBe(true)
    const { data } = await db
      .from('catalog_collections')
      .select('meta_product_set_id')
      .eq('id', 'col-1')
      .maybeSingle()
    expect(data?.meta_product_set_id).toBe('ps-99')
  })

  it('republishes every local set during a full sync', async () => {
    const fetchMock = mockGraph({ id: 'ps-99' })
    vi.stubGlobal('fetch', fetchMock)
    const db = seedDb()
    await publishAllCatalogSetsToMeta(db, 'acct-a')
    const write = productSetWriteCall(fetchMock)
    expect(write).toBeTruthy()
    const body = JSON.parse(String(write![1].body))
    expect(JSON.parse(body.filter)).toEqual({
      retailer_id: { is_any: ['BAG-RED'] },
    })
  })
})
