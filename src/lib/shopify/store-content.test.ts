import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { htmlToText } from './html-to-text'
import {
  handleShopifyPageWebhook,
  isDeliveryOrShippingIntent,
  policyResourceId,
  removeStoreContent,
  retrieveShopifyStoreContent,
  searchStoreContent,
  storeContentSearchNeedles,
  toPageGid,
  upsertStoreContentPage,
} from './store-content'
import * as client from './client'
import * as configModule from './config'
import type { ShopifyStoreConfig } from './types'

const STORE: ShopifyStoreConfig = {
  accountId: 'account-1',
  shopDomain: 'acme.myshopify.com',
  accessToken: 'shpat_test',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'USD',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

function mockDb() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const insert = vi.fn().mockResolvedValue({ error: null })
  const deleteFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ error: null, count: 1 }),
      then: (
        resolve: (value: { error: null; count: number }) => unknown,
      ) => resolve({ error: null, count: 1 }),
    }),
  })
  const selectCount = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ count: 3, error: null }),
  })
  const updateConfig = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ error: null }),
  })
  const ilike = vi.fn().mockReturnValue({
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
  })
  const selectSearch = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({ ilike }),
  })

  const from = vi.fn((table: string) => {
    if (table === 'shopify_store_content') {
      return {
        upsert,
        insert,
        delete: deleteFn,
        select: (cols: string) => {
          if (cols === '*' || cols.includes('count')) return selectCount()
          return selectSearch()
        },
      }
    }
    if (table === 'shopify_configs') {
      return { update: updateConfig }
    }
    return {}
  })

  const rpc = vi.fn().mockResolvedValue({ data: [], error: null })

  return {
    db: { from, rpc } as unknown as SupabaseClient,
    upsert,
    deleteFn,
    rpc,
  }
}

describe('htmlToText', () => {
  it('strips tags and decodes entities', () => {
    expect(
      htmlToText('<p>Hello&nbsp;<strong>world</strong></p><br/>&amp; co'),
    ).toMatch(/Hello world/)
    expect(htmlToText('<p>Hello&nbsp;<strong>world</strong></p>')).toContain('Hello')
    expect(htmlToText('<script>alert(1)</script>Safe')).toBe('Safe')
  })

  it('extracts nested shopify-policy__body HTML', async () => {
    const { extractHtmlByClass } = await import('./html-to-text')
    const html = `
      <div class="shopify-policy__container">
        <div class="shopify-policy__body">
          <div class="rte"><p>Returns in 30 days.</p></div>
        </div>
      </div>`
    expect(extractHtmlByClass(html, 'shopify-policy__body')).toMatch(/Returns in 30 days/)
  })
})

describe('page ids', () => {
  it('builds page GIDs and policy resource ids', () => {
    expect(toPageGid('42')).toBe('gid://shopify/Page/42')
    expect(toPageGid('gid://shopify/Page/9')).toBe('gid://shopify/Page/9')
    expect(policyResourceId('privacy_policy')).toBe(
      'gid://shopify/ShopPolicy/PRIVACY_POLICY',
    )
  })
})

describe('store content webhooks', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('upserts a published page from Admin GraphQL', async () => {
    vi.spyOn(client, 'shopifyGraphql').mockResolvedValue({
      page: {
        id: 'gid://shopify/Page/7',
        handle: 'about',
        title: 'About Us',
        body: '<p>We make bags.</p>',
        isPublished: true,
      },
    })
    const { db, upsert } = mockDb()
    const ok = await upsertStoreContentPage(db, STORE, '7')
    expect(ok).toBe(true)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'account-1',
        shopify_resource_id: 'gid://shopify/Page/7',
        kind: 'page',
        handle: 'about',
        title: 'About Us',
        body: 'We make bags.',
        page_url: 'https://shop.example/pages/about',
      }),
      { onConflict: 'account_id,shopify_resource_id' },
    )
  })

  it('removes unpublished pages on update webhook', async () => {
    vi.spyOn(configModule, 'loadShopifyConfig').mockResolvedValue(STORE)
    const { db, deleteFn } = mockDb()
    await handleShopifyPageWebhook(db, STORE.accountId, 'pages/update', {
      id: 7,
      published_at: null,
    })
    expect(deleteFn).toHaveBeenCalled()
  })

  it('removes rows on delete webhook', async () => {
    vi.spyOn(configModule, 'loadShopifyConfig').mockResolvedValue(STORE)
    const { db, deleteFn } = mockDb()
    await handleShopifyPageWebhook(db, STORE.accountId, 'pages/delete', {
      admin_graphql_api_id: 'gid://shopify/Page/7',
    })
    expect(deleteFn).toHaveBeenCalled()
  })

  it('delete helper matches numeric and gid ids', async () => {
    const inFn = vi.fn().mockResolvedValue({ error: null, count: 1 })
    const eqFn = vi.fn().mockReturnValue({ in: inFn })
    const deleteFn = vi.fn().mockReturnValue({ eq: eqFn })
    const db = {
      from: vi.fn().mockReturnValue({ delete: deleteFn }),
    } as unknown as SupabaseClient

    await removeStoreContent(db, 'account-1', '7')
    expect(inFn).toHaveBeenCalledWith(
      'shopify_resource_id',
      expect.arrayContaining(['7', 'gid://shopify/Page/7']),
    )
  })
})

describe('syncStoreContent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('inserts policies and published pages, skipping drafts', async () => {
    const gql = vi.spyOn(client, 'shopifyGraphql')
    gql.mockResolvedValueOnce({
      shop: {
        shopPolicies: [
          {
            type: 'REFUND_POLICY',
            title: 'Refund Policy',
            body: '<p>Returns in 30 days.</p>',
            url: 'https://shop.example/policies/refund-policy',
          },
        ],
      },
    })
    gql.mockResolvedValueOnce({
      pages: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: 'gid://shopify/Page/1',
            handle: 'about',
            title: 'About',
            body: '<p>We make bags.</p>',
            isPublished: true,
          },
          {
            id: 'gid://shopify/Page/2',
            handle: 'draft-page',
            title: 'Hidden',
            body: '<p>Nope</p>',
            isPublished: false,
          },
        ],
      },
    })

    const insert = vi.fn().mockResolvedValue({ error: null })
    const deleteFn = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    })
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'shopify_store_content') {
          return {
            delete: deleteFn,
            insert,
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
            }),
          }
        }
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    } as unknown as SupabaseClient

    const { syncStoreContent } = await import('./store-content')
    const result = await syncStoreContent(db, STORE)
    expect(result.count).toBe(2)
    expect(insert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'policy',
          title: 'Refund Policy',
          body: 'Returns in 30 days.',
        }),
        expect.objectContaining({
          kind: 'page',
          handle: 'about',
          title: 'About',
        }),
      ]),
    )
    const inserted = insert.mock.calls[0][0] as { handle?: string }[]
    expect(inserted.some((r) => r.handle === 'draft-page')).toBe(false)
  })
})

function mockSearchDb(opts: {
  rpc?: { data?: unknown; error?: { code?: string; message?: string } | null }
  tableRows?: Record<string, unknown>[]
  tableError?: { code: string; message: string }
  kbDocs?: { title: string; content: string }[]
}) {
  const rpc = vi.fn().mockResolvedValue({
    data: opts.rpc?.data ?? [],
    error: opts.rpc?.error ?? null,
  })
  const tableLimit = vi.fn().mockResolvedValue(
    opts.tableError
      ? { data: null, error: opts.tableError }
      : { data: opts.tableRows ?? [], error: null },
  )
  const kbLimit = vi.fn().mockResolvedValue({
    data: opts.kbDocs ?? [],
    error: null,
  })
  const from = vi.fn((table: string) => {
    if (table === 'ai_knowledge_documents') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            like: vi.fn().mockReturnValue({ limit: kbLimit }),
          }),
        }),
      }
    }
    return {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({ limit: tableLimit }),
        }),
      }),
    }
  })
  return { rpc, from, tableLimit, kbLimit } as unknown as SupabaseClient & {
    rpc: ReturnType<typeof vi.fn>
    from: ReturnType<typeof vi.fn>
  }
}

describe('storeContentSearchNeedles', () => {
  it('adds shipping synonyms for a delivery-time question', () => {
    expect(isDeliveryOrShippingIntent('product delivery time')).toBe(true)
    expect(storeContentSearchNeedles('how long for delivery')).toEqual(
      expect.arrayContaining(['how long for delivery', 'shipping', 'delivery']),
    )
  })
})

describe('searchStoreContent', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns FTS hits as excerpts for the AI prompt', async () => {
    const db = mockSearchDb({
      rpc: {
        data: [
          {
            kind: 'policy',
            title: 'Refund Policy',
            handle: 'refund-policy',
            body: 'Returns accepted within 30 days.',
            page_url: 'https://shop.example/policies/refund-policy',
          },
        ],
      },
    })

    const excerpts = await retrieveShopifyStoreContent(
      db,
      'account-1',
      'what is your return policy',
      5,
    )
    expect(db.rpc).toHaveBeenCalledWith(
      'match_shopify_store_content_fts',
      expect.objectContaining({ p_account_id: 'account-1' }),
    )
    expect(excerpts[0]).toContain('Policy: Refund Policy')
    expect(excerpts[0]).toContain('Returns accepted within 30 days.')
  })

  it('falls back to ilike when FTS is empty', async () => {
    const db = mockSearchDb({
      tableRows: [
        {
          kind: 'page',
          title: 'FAQ',
          handle: 'faq',
          body: 'We ship worldwide.',
          page_url: 'https://shop.example/pages/faq',
        },
      ],
    })

    const hits = await searchStoreContent(db, 'account-1', 'shipping', 5)
    expect(hits[0]?.title).toBe('FAQ')
    expect(hits[0]?.kind).toBe('page')
  })

  it('falls back to [Shopify] knowledge docs when the snapshot table is missing', async () => {
    const missing = {
      code: 'PGRST205',
      message:
        "Could not find the table 'public.shopify_store_content' in the schema cache",
    }
    const db = mockSearchDb({
      rpc: { error: missing },
      tableError: missing,
      kbDocs: [
        {
          title: '[Shopify] Privacy policy',
          content: 'We collect shipping address and phone number.',
        },
        {
          title: '[Shopify] Shipping',
          content:
            'Free shipping within Kerala. Delivery time: 5 to 10 business days depending on your pin code.',
        },
      ],
    })

    const hits = await searchStoreContent(
      db,
      'account-1',
      'product delivery time',
      5,
    )
    expect(hits[0]?.title).toBe('Shipping')
    expect(hits[0]?.kind).toBe('policy')
    expect(hits[0]?.body).toMatch(/5 to 10 business days/)
    expect(hits.map((h) => h.title)).not.toContain('Privacy policy')
  })
})
