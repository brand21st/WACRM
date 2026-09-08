import { describe, expect, it, vi } from 'vitest'
import { intelSeed } from '@/lib/catalog/intelligence/facts.test'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import { loadCatalogSalesMode } from '@/lib/catalog/intelligence/recommend'
import { listRecommendedProducts } from './recommend'
import { executeShopifyTool, shopifyLlmTools } from './tools'
import type { ShopifyStoreConfig } from './types'

const STORE: ShopifyStoreConfig = {
  accountId: 'acct-a',
  shopDomain: 'acme.myshopify.com',
  accessToken: 't',
  isActive: true,
  shopName: 'Acme',
  primaryDomain: 'https://shop.example',
  currency: 'INR',
  metaCatalogId: null,
  lastVerifiedAt: null,
  lastCatalogSyncAt: null,
  catalogProductCount: 0,
}

function salesDb(mode: 'off' | 'shadow' | 'on') {
  const seed = intelSeed()
  return createCatalogMemoryDb({
    ...seed,
    catalog_external_ids: [
      {
        id: 'ext-red',
        account_id: 'acct-a',
        product_id: 'p-red',
        variant_id: null,
        source: 'shopify',
        entity: 'product',
        external_id: 'gid://shopify/Product/17',
      },
    ],
    ai_configs: [
      {
        account_id: 'acct-a',
        catalog_sales_automation: mode,
        catalog_hybrid_search: 'off',
      },
    ],
  })
}

describe('listRecommendedProducts sales flag', () => {
  it('keeps Shopify AJAX fill when the flag is off', async () => {
    const db = salesDb('off')
    const fetchImpl = vi.fn(async () => Response.json({ products: [] }))
    await listRecommendedProducts(
      db,
      STORE,
      { query: 'Red Bag' },
      { role: 'similar', seedId: 'p-red', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('skips AJAX and new-arrivals when the flag is on', async () => {
    const db = salesDb('on')
    const fetchImpl = vi.fn(async () =>
      Response.json({ products: [{ handle: 'ajax-only', title: 'Ajax Only' }] }),
    )
    const hits = await listRecommendedProducts(
      db,
      STORE,
      { query: 'Red Bag' },
      { role: 'bundle', seedId: 'p-red', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(hits).toEqual([])
  })

  it('returns Phase 4 complements when on and Shopify is disconnected', async () => {
    const db = salesDb('on')
    const hits = await listRecommendedProducts(
      db,
      { ...STORE, primaryDomain: null, accessToken: '' },
      {},
      { role: 'cross_sell', seedId: 'p-red' },
    )
    expect(hits.map((hit) => hit.catalogId)).toEqual(['p-cheap'])
    expect(hits[0].recommendReasons).toContain('relation_cross_sell')
  })

  it('shadows Phase 4 but still returns the 3B path', async () => {
    const db = salesDb('shadow')
    const fetchImpl = vi.fn(async () =>
      Response.json({ products: [{ handle: 'navy-bag', title: 'Navy Bag' }] }),
    )
    const hits = await listRecommendedProducts(
      db,
      STORE,
      { query: 'Red Bag' },
      { role: 'cross_sell', seedId: 'p-red', fetchImpl: fetchImpl as unknown as typeof fetch },
    )
    expect(fetchImpl).toHaveBeenCalled()
    const { data } = await db.from('catalog_recommendation_events').select()
    expect(
      (data as { event?: string }[]).some((row) => row.event === 'generated'),
    ).toBe(true)
    expect(hits.map((hit) => hit.handle)).toContain('navy-bag')
  })

  it('rolls back from on to off without deleting data and restores AJAX', async () => {
    const db = salesDb('on')
    const fetchOn = vi.fn(async () =>
      Response.json({ products: [{ handle: 'ajax-only', title: 'Ajax Only' }] }),
    )
    const onHits = await listRecommendedProducts(
      db,
      STORE,
      { query: 'Red Bag' },
      { role: 'bundle', seedId: 'p-red', fetchImpl: fetchOn as unknown as typeof fetch },
    )
    expect(fetchOn).not.toHaveBeenCalled()
    expect(onHits).toEqual([])

    await db.from('ai_configs').upsert(
      {
        account_id: 'acct-a',
        catalog_sales_automation: 'off',
        catalog_hybrid_search: 'off',
      },
      { onConflict: 'account_id' },
    )

    expect(await loadCatalogSalesMode(db, 'acct-a')).toBe('off')
    const fetchOff = vi.fn(async () => Response.json({ products: [] }))
    await listRecommendedProducts(
      db,
      STORE,
      { query: 'Red Bag' },
      { role: 'similar', seedId: 'p-red', fetchImpl: fetchOff as unknown as typeof fetch },
    )
    expect(fetchOff).toHaveBeenCalled()
  })
})

describe('recommend_products tool sales output', () => {
  it('includes bundle in the tool enum and reason JSON when on', async () => {
    const recommend = shopifyLlmTools({ shopifyConnected: false }).find(
      (tool) => tool.name === 'recommend_products',
    )
    const params = recommend?.parameters as { properties?: { role?: { enum?: string[] } } }
    expect(params.properties?.role?.enum).toEqual(
      expect.arrayContaining(['bundle', 'cross_sell', 'upsell']),
    )
    const db = salesDb('on')
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, primaryDomain: null },
        contactPhone: null,
        customerText: 'complete the look',
      },
      'recommend_products',
      { role: 'cross_sell', seed_id: 'p-red' },
    )
    const body = JSON.parse(result.json) as {
      recommendations?: { id: string; reasons: string[]; mode: string }[]
      note?: string
    }
    expect(body.note).toBe('complete_the_look')
    expect(body.recommendations?.[0]).toMatchObject({
      id: 'p-cheap',
      mode: 'cross_sell',
    })
    expect(body.recommendations?.[0].reasons).toContain('relation_cross_sell')
  })

  it('does not invent a bundle note with products', async () => {
    const db = salesDb('on')
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, primaryDomain: null },
        contactPhone: null,
      },
      'recommend_products',
      { role: 'bundle', seed_id: 'p-red' },
    )
    const body = JSON.parse(result.json) as { products: unknown[]; note?: string }
    expect(body.products).toEqual([])
    expect(body.note).toMatch(/Do not invent a bundle/)
  })

  it('does not add Phase 4 notes when the flag is off', async () => {
    const db = salesDb('off')
    const result = await executeShopifyTool(
      {
        db,
        config: { ...STORE, primaryDomain: null },
        contactPhone: null,
        customerText: 'complete the look',
      },
      'recommend_products',
      { role: 'cross_sell', seed_id: 'p-red' },
    )
    const body = JSON.parse(result.json) as { note?: string }
    expect(body.note).toBeUndefined()
  })
})
