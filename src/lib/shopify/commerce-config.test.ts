import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import {
  commerceMetaCatalogIds,
  ensureCatalogCommerceRow,
  resolveMetaCatalogSelection,
  saveCommerceSettings,
  settingsFromRow,
} from './commerce-config'

describe('ensureCatalogCommerceRow', () => {
  it('inserts a catalog-only shopify_configs row when none exists', async () => {
    const db = createCatalogMemoryDb({ shopify_configs: [] })
    await ensureCatalogCommerceRow(db, 'acct-a', 'user-1')
    const { data } = await db.from('shopify_configs').select()
    expect(data).toEqual([
      expect.objectContaining({
        account_id: 'acct-a',
        shop_domain: '',
        access_token: '',
        is_active: false,
      }),
    ])
  })

  it('does not insert a second row when Shopify is already connected', async () => {
    const db = createCatalogMemoryDb({
      shopify_configs: [{ id: 'cfg-1', account_id: 'acct-a', shop_domain: 'acme.myshopify.com' }],
    })
    await ensureCatalogCommerceRow(db, 'acct-a', 'user-1')
    const { data } = await db.from('shopify_configs').select()
    expect(data).toHaveLength(1)
    expect(data?.[0]).toEqual(
      expect.objectContaining({ id: 'cfg-1', shop_domain: 'acme.myshopify.com' }),
    )
  })
})

describe('meta catalog selection', () => {
  it('falls back to the single primary id when the array is empty', () => {
    expect(
      commerceMetaCatalogIds({
        metaCatalogId: 'cat-1',
        metaCatalogIds: [],
      }),
    ).toEqual(['cat-1'])
    expect(
      commerceMetaCatalogIds({
        metaCatalogId: null,
        metaCatalogIds: [],
      }),
    ).toEqual([])
  })

  it('keeps the current primary when it is still checked', () => {
    expect(resolveMetaCatalogSelection(['b', 'a'], 'a')).toEqual({
      metaCatalogIds: ['b', 'a'],
      metaCatalogId: 'a',
    })
    expect(resolveMetaCatalogSelection(['b', 'c'], 'a')).toEqual({
      metaCatalogIds: ['b', 'c'],
      metaCatalogId: 'b',
    })
    expect(resolveMetaCatalogSelection([], 'a')).toEqual({
      metaCatalogIds: [],
      metaCatalogId: null,
    })
  })

  it('writes selected ids and the resolved primary', async () => {
    const db = createCatalogMemoryDb({
      shopify_configs: [
        {
          account_id: 'acct-a',
          meta_catalog_id: 'old',
          meta_catalog_ids: ['old'],
        },
      ],
    })
    await saveCommerceSettings(db, 'acct-a', {
      metaCatalogIds: ['cat-2', 'cat-1'],
      metaCatalogId: 'cat-1',
    })
    const { data } = await db
      .from('shopify_configs')
      .select()
      .eq('account_id', 'acct-a')
      .maybeSingle()
    expect(data).toEqual(
      expect.objectContaining({
        meta_catalog_id: 'cat-1',
        meta_catalog_ids: ['cat-2', 'cat-1'],
      }),
    )
    expect(
      settingsFromRow(data as Record<string, unknown>).metaCatalogIds,
    ).toEqual(['cat-2', 'cat-1'])
  })
})
