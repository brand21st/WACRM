import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  ingestDocument: vi.fn(),
  loadEmbeddingsKey: vi.fn(),
}))

vi.mock('@/lib/ai/knowledge', () => ({
  ingestDocument: (...args: unknown[]) => h.ingestDocument(...args),
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: (...args: unknown[]) => h.loadEmbeddingsKey(...args),
}))

import {
  formatShopifyProductKnowledge,
  removeAllShopifyProductKnowledge,
  removeShopifyProductKnowledge,
  shopifyProductKnowledgeTitle,
  syncShopifyProductKnowledge,
  upsertShopifyProductKnowledge,
} from './product-knowledge'
import type { ShopifyProductHit } from './types'

const HIT: ShopifyProductHit = {
  id: 'gid://shopify/Product/42',
  handle: 'red-bag',
  title: 'Red Bag',
  description: 'Handmade leather tote.',
  imageUrl: null,
  productUrl: 'https://shop.example/products/red-bag',
  cartUrl: null,
  checkoutUrl: null,
  priceMin: '49.00',
  priceMax: '59.00',
  currency: 'USD',
  variants: [
    {
      id: 'v1',
      variantId: '99',
      title: 'Small',
      sku: 'BAG-S',
      price: '49.00',
      compareAtPrice: null,
      available: true,
      options: [],
    },
  ],
}

function knowledgeDb(existing?: { id: string; title: string; content: string } | null) {
  const inserts: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const deletes: Record<string, unknown>[] = []
  const catalogRows: { shopify_product_id: string; product_url: string }[] = [
    { shopify_product_id: HIT.id, product_url: HIT.productUrl },
  ]
  const docs = existing
    ? [{ id: existing.id, title: existing.title, content: existing.content, source_url: HIT.productUrl }]
    : []

  const db = {
    from: (table: string) => {
      if (table === 'shopify_catalog_products') {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: catalogRows, error: null }),
            }),
          }),
        }
      }
      if (table === 'ai_knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: existing ?? null,
                  error: null,
                }),
              }),
              like: async () => ({ data: docs, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: 'doc-1' }, error: null }),
              }),
            }
          },
          update: (row: Record<string, unknown>) => {
            updates.push(row)
            return {
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }
          },
          delete: () => ({
            eq: () => ({
              in: async (_col: string, values: string[]) => {
                deletes.push({ values })
                return { error: null }
              },
              like: async (col: string, value: string) => {
                deletes.push({ [col]: value })
                return { error: null }
              },
            }),
          }),
        }
      }
      return {}
    },
  }
  return { db: db as unknown as SupabaseClient, inserts, updates, deletes }
}

beforeEach(() => {
  h.ingestDocument.mockReset()
  h.loadEmbeddingsKey.mockReset()
  h.ingestDocument.mockResolvedValue(undefined)
  h.loadEmbeddingsKey.mockResolvedValue({ key: null, corrupt: false })
})

describe('Shopify product knowledge format', () => {
  it('prefixes the title and includes price, variants, and URL', () => {
    expect(shopifyProductKnowledgeTitle('Red Bag')).toBe('[Shopify Product] Red Bag')
    const body = formatShopifyProductKnowledge(HIT)
    expect(body).toContain('Red Bag')
    expect(body).toContain('Handmade leather tote.')
    expect(body).toContain('Price: 49.00–59.00 USD')
    expect(body).toContain('Small 49.00 (in stock)')
    expect(body).toContain('https://shop.example/products/red-bag')
  })
})

describe('upsertShopifyProductKnowledge', () => {
  it('inserts by source_url and ingests with the product title', async () => {
    const { db, inserts } = knowledgeDb(null)
    const id = await upsertShopifyProductKnowledge(db, 'acct', HIT)
    expect(id).toBe('doc-1')
    expect(inserts[0]).toMatchObject({
      title: '[Shopify Product] Red Bag',
      source_type: 'url',
      source_url: HIT.productUrl,
    })
    expect(h.ingestDocument).toHaveBeenCalledWith(
      db,
      'acct',
      { embeddingsApiKey: null },
      'doc-1',
      expect.stringContaining('Handmade leather tote.'),
      '[Shopify Product] Red Bag',
    )
  })

  it('skips ingest when title and body are unchanged', async () => {
    const content = formatShopifyProductKnowledge(HIT)
    const title = shopifyProductKnowledgeTitle(HIT.title)
    const { db } = knowledgeDb({ id: 'doc-9', title, content })
    const id = await upsertShopifyProductKnowledge(db, 'acct', HIT)
    expect(id).toBe('doc-9')
    expect(h.ingestDocument).not.toHaveBeenCalled()
  })
})

describe('removeShopifyProductKnowledge', () => {
  it('deletes the KB doc by product URL looked up from catalog ids', async () => {
    const { db, deletes } = knowledgeDb()
    await removeShopifyProductKnowledge(db, 'acct', { productIds: [HIT.id] })
    expect(deletes[0]).toMatchObject({ values: [HIT.productUrl] })
  })

  it('deletes all Shopify product docs on disconnect', async () => {
    const { db, deletes } = knowledgeDb()
    await removeAllShopifyProductKnowledge(db, 'acct')
    expect(deletes[0]).toMatchObject({ title: '[Shopify Product] %' })
  })
})

describe('syncShopifyProductKnowledge', () => {
  it('prunes leftover product docs', async () => {
    const deletes: Record<string, unknown>[] = []
    const db = {
      from: (table: string) => {
        if (table !== 'ai_knowledge_documents') return {}
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              like: async () => ({
                data: [
                  {
                    id: 'keep-1',
                    source_url: HIT.productUrl,
                  },
                  {
                    id: 'stale-1',
                    source_url: 'https://shop.example/products/old-bag',
                  },
                ],
                error: null,
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'doc-1' }, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              in: async (_col: string, values: string[]) => {
                deletes.push({ values })
                return { error: null }
              },
            }),
          }),
        }
      },
    } as unknown as SupabaseClient

    await syncShopifyProductKnowledge(db, 'acct', [HIT])
    expect(h.ingestDocument).toHaveBeenCalled()
    expect(deletes[0]).toMatchObject({ values: ['stale-1'] })
  })
})
