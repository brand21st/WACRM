import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { intelProduct, intelSeed, intelVariant } from './facts.test'
import { parseShoppingRequirements } from './requirements'
import { getRecommendations, loadCatalogSalesMode } from './recommend'
import { emptyShoppingContext, mergeShoppingContext } from './shopping-context'

function salesDb(
  mode: 'off' | 'shadow' | 'on' = 'on',
  extra: Record<string, Record<string, unknown>[]> = {}
) {
  const seed = intelSeed()
  return createCatalogMemoryDb({
    ...seed,
    ...extra,
    ai_configs: [
      {
        account_id: 'acct-a',
        catalog_sales_automation: mode,
        catalog_hybrid_search: 'off',
      },
    ],
  })
}

describe('loadCatalogSalesMode', () => {
  it('defaults to off when the column is missing or unknown', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    expect(await loadCatalogSalesMode(db, 'acct-a')).toBe('off')
    const broken = createCatalogMemoryDb({
      ai_configs: [{ account_id: 'acct-a', catalog_sales_automation: 'maybe' }],
    })
    expect(await loadCatalogSalesMode(broken, 'acct-a')).toBe('off')
  })
})

describe('getRecommendations', () => {
  it('isolates tenants and unknown seeds', async () => {
    const db = salesDb()
    const other = await getRecommendations(db, {
      accountId: 'acct-b',
      mode: 'similar',
      seedId: 'p-red',
    })
    expect(other.map((row) => row.product.id)).not.toContain('p-red')
    expect(other.every((row) => row.product.accountId === 'acct-b')).toBe(true)
    expect(
      await getRecommendations(db, {
        accountId: 'acct-b',
        mode: 'cross_sell',
        seedId: 'p-red',
      })
    ).toEqual([])
    expect(
      await getRecommendations(db, {
        accountId: 'acct-a',
        mode: 'upsell',
        seedId: 'missing',
      })
    ).toEqual([])
  })

  it('never returns the seed, oos, or another account', async () => {
    const db = salesDb()
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'similar',
      seedId: 'p-red',
      limit: 10,
    })
    const ids = rows.map((row) => row.product.id)
    expect(ids).not.toContain('p-red')
    expect(ids).not.toContain('p-oos')
    expect(ids).not.toContain('p-b')
  })

  it('blocks upsell above a hard budget', async () => {
    const db = salesDb()
    const blocked = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'upsell',
      seedId: 'p-red',
      requirements: { maxPrice: 50 },
    })
    expect(blocked).toEqual([])
    const open = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'upsell',
      seedId: 'p-red',
    })
    expect(open).toHaveLength(1)
    expect(open[0].product.priceMin).toBeGreaterThan(49)
    expect(open[0].product.priceMin).toBeLessThanOrEqual(49 * 1.5)
  })

  it('does not treat another bag as a cross-sell', async () => {
    const seed = intelSeed()
    seed.catalog_product_relations = seed.catalog_product_relations.filter(
      (row) => (row as { kind?: string }).kind !== 'cross_sell'
    )
    const db = createCatalogMemoryDb({
      ...seed,
      ai_configs: [
        {
          account_id: 'acct-a',
          catalog_sales_automation: 'on',
          catalog_hybrid_search: 'off',
        },
      ],
    })
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'cross_sell',
      seedId: 'p-red',
    })
    expect(rows.map((row) => row.product.id)).not.toContain('p-navy')
    expect(rows.map((row) => row.product.id)).not.toContain('p-gold')
    expect(rows).toEqual([])
  })

  it('uses an explicit cross-sell relation and writes generated events', async () => {
    const db = salesDb()
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      contactId: 'c1',
      conversationId: 'conv-1',
      mode: 'cross_sell',
      seedId: 'p-red',
    })
    expect(rows.map((row) => row.product.id)).toEqual(['p-cheap'])
    expect(rows[0].reasons).toContain('relation_cross_sell')
    const { data } = await db.from('catalog_recommendation_events').select()
    expect(data).toHaveLength(1)
    expect(
      (data as { event?: string; account_id?: string }[])[0]
    ).toMatchObject({
      event: 'generated',
      account_id: 'acct-a',
      product_id: 'p-cheap',
    })
  })

  it('returns no invented bundle when relations are empty', async () => {
    const db = salesDb()
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'bundle',
      seedId: 'p-red',
    })
    expect(rows).toEqual([])
  })

  it('returns bundle rows only from sort_order relations', async () => {
    const db = salesDb('on', {
      catalog_product_relations: [
        ...intelSeed().catalog_product_relations,
        {
          account_id: 'acct-a',
          product_id: 'p-red',
          related_product_id: 'p-cheap',
          kind: 'bundle',
          sort_order: 0,
        },
      ],
    })
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'bundle',
      seedId: 'p-red',
    })
    expect(rows.map((row) => row.product.id)).toEqual(['p-cheap'])
    expect(rows[0].reasons).toContain('relation_bundle')
  })

  it('applies alternative hard filters for cheaper, variant, and dislikes', async () => {
    const db = salesDb()
    const cheaper = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'alternative',
      seedId: 'p-red',
      requirements: { cheaper: true },
    })
    expect(cheaper.every((row) => (row.product.priceMax ?? 0) < 49)).toBe(true)
    const sized = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'alternative',
      seedId: 'p-red',
      requirements: { optionName: 'Size', optionValue: 'M' },
    })
    expect(sized.every((row) => row.product.id !== 'p-gold')).toBe(true)
    const noRed = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'alternative',
      seedId: 'p-navy',
      shopping: { ...emptyShoppingContext(), dislikes: ['red'] },
    })
    expect(noRed.map((row) => row.product.id)).not.toContain('p-red')
    expect(
      noRed.map((row) => row.product.title.toLowerCase()).join(' ')
    ).not.toMatch(/\bred\b/)
  })

  it('dedupes cart and paid retailer ids and skips unmatched ones', async () => {
    const db = salesDb('on', {
      whatsapp_commerce_orders: [
        {
          account_id: 'acct-a',
          contact_id: 'c1',
          status: 'processing',
          payment_id: 'pay_1',
          line_items: [
            { retailer_id: 'BAG-RED' },
            { retailer_id: 'NO-SUCH-SKU' },
          ],
        },
      ],
    })
    const upsell = await getRecommendations(db, {
      accountId: 'acct-a',
      contactId: 'c1',
      mode: 'upsell',
      seedId: 'p-red',
      cartRetailerIds: ['BAG-NAVY'],
    })
    expect(upsell.map((row) => row.product.id)).not.toContain('p-navy')
    const complement = await getRecommendations(db, {
      accountId: 'acct-a',
      contactId: 'c1',
      mode: 'cross_sell',
    })
    expect(complement.map((row) => row.product.id)).toEqual(['p-cheap'])
  })

  it('works without contact, cart, or orders', async () => {
    const db = salesDb()
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'similar',
      seedId: 'p-red',
    })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('does not invent prices, stock, or ids', async () => {
    const db = salesDb()
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'recommend',
      seedId: 'p-red',
    })
    for (const row of rows) {
      expect(row.product.id).toMatch(/^p-/)
      expect(row.product.priceMin).toEqual(expect.any(Number))
      expect(row.product.variants.some((variant) => variant.available)).toBe(
        true
      )
    }
  })

  it('binds Malayalam and 5k budgets so upsell never exceeds the cap', async () => {
    const db = salesDb()
    const fiveK = parseShoppingRequirements('under 5k')
    const malayalam = parseShoppingRequirements('5000 രൂപയ്ക്കുള്ളിൽ')
    expect(fiveK.maxPrice).toBe(5000)
    expect(malayalam.maxPrice).toBe(5000)
    const underCap = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'upsell',
      seedId: 'p-red',
      customerText: 'under 5k',
    })
    expect(underCap.every((row) => (row.product.priceMin ?? 0) <= 5000)).toBe(
      true
    )
    const blocked = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'upsell',
      seedId: 'p-red',
      customerText: '50 രൂപയ്ക്കുള്ളിൽ',
    })
    expect(blocked).toEqual([])
  })

  it('uses the second shown product as the similar seed', async () => {
    const db = salesDb()
    const shopping = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      text: 'show me something similar to the second one',
      shownIds: ['p-red', 'p-navy'],
    })
    expect(shopping.selectedIds).toEqual(['p-navy'])
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'similar',
      shopping,
    })
    expect(rows.map((row) => row.product.id)).not.toContain('p-navy')
    expect(rows.length).toBeGreaterThan(0)
  })

  it('drops disliked colors on a cheaper alternative ask', async () => {
    const db = salesDb()
    const text = "I don't like red, something cheaper"
    const parsed = parseShoppingRequirements(text)
    expect(parsed.cheaper).toBe(true)
    const shopping = {
      ...emptyShoppingContext(),
      dislikes: ['red'],
    }
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'alternative',
      seedId: 'p-navy',
      shopping,
      requirements: { cheaper: parsed.cheaper },
    })
    expect(rows.map((row) => row.product.id)).toContain('p-cheap')
    expect(rows.map((row) => row.product.id)).not.toContain('p-red')
    expect(rows.every((row) => (row.product.priceMax ?? 0) < 55)).toBe(true)
  })

  it('returns no complement when the customer asks what goes well and none exists', async () => {
    const seed = intelSeed()
    seed.catalog_product_relations = seed.catalog_product_relations.filter(
      (row) => (row as { kind?: string }).kind !== 'cross_sell'
    )
    const db = createCatalogMemoryDb({
      ...seed,
      ai_configs: [
        {
          account_id: 'acct-a',
          catalog_sales_automation: 'on',
          catalog_hybrid_search: 'off',
        },
      ],
    })
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'cross_sell',
      seedId: 'p-red',
      customerText: 'what goes well with this?',
    })
    expect(rows).toEqual([])
  })

  it('falls back to lexical when semantic fill cannot run', async () => {
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      ai_configs: [
        {
          account_id: 'acct-a',
          catalog_sales_automation: 'on',
          catalog_hybrid_search: 'on',
        },
      ],
    })
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'similar',
      seedId: 'p-red',
    })
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('intel extras stay account scoped', () => {
  it('does not hydrate a foreign wallet as a complement', async () => {
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      catalog_products: [
        ...intelSeed().catalog_products,
        intelProduct({
          id: 'p-wallet',
          account_id: 'acct-b',
          handle: 'wallet',
          title: 'Leather Wallet',
          price_min: 20,
          price_max: 20,
        }),
      ],
      catalog_variants: [
        ...intelSeed().catalog_variants,
        intelVariant({
          id: 'v-wallet',
          account_id: 'acct-b',
          product_id: 'p-wallet',
          sku: 'WALLET',
          retailer_id: 'WALLET',
        }),
      ],
      ai_configs: [{ account_id: 'acct-a', catalog_sales_automation: 'on' }],
    })
    const rows = await getRecommendations(db, {
      accountId: 'acct-a',
      mode: 'cross_sell',
      seedId: 'p-red',
    })
    expect(rows.map((row) => row.product.id)).not.toContain('p-wallet')
  })
})

describe('recommendation intelligence shadow', () => {
  it('preserves exact output and leaves learned work to the processor', async () => {
    const seed = intelSeed()
    const common = {
      ...seed,
      catalog_recommendation_stats: [
        {
          account_id: 'acct-a',
          product_id: 'p-gold',
          mode: 'similar',
          smoothed_selection_rate: 0.95,
          smoothed_rejection_rate: 0.05,
          shown_count: 20,
        },
      ],
    }
    const off = createCatalogMemoryDb({
      ...common,
      ai_configs: [
        {
          account_id: 'acct-a',
          catalog_sales_automation: 'on',
          catalog_hybrid_search: 'off',
          recommendation_intelligence: 'off',
        },
      ],
    })
    const shadow = createCatalogMemoryDb({
      ...common,
      ai_configs: [
        {
          account_id: 'acct-a',
          catalog_sales_automation: 'on',
          catalog_hybrid_search: 'off',
          recommendation_intelligence: 'shadow',
        },
      ],
    })
    const input = {
      accountId: 'acct-a',
      conversationId: 'conv-shadow',
      sourceMessageId: 'message-shadow',
      mode: 'similar' as const,
      seedId: 'p-red',
      limit: 10,
    }
    const baselineRows = await getRecommendations(off, input)
    const shadowRows = await getRecommendations(shadow, input)
    expect(shadowRows).toEqual(baselineRows)
    expect(
      shadowRows.every(
        (row) =>
          row.product.accountId === 'acct-a' &&
          row.product.status === 'active' &&
          row.product.variants.some((variant) => variant.available)
      )
    ).toBe(true)
    const { data } = await shadow
      .from('catalog_recommendation_events')
      .select()
      .eq('ranking_variant', 'shadow')
    expect(data).toEqual([])
  })
})
