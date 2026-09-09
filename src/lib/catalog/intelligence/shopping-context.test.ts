import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { intelSeed } from './facts.test'
import { parseShoppingRequirements } from './requirements'
import {
  emptyShoppingContext,
  formatSalesSnapshot,
  mergeShoppingContext,
  persistShoppingContext,
  loadShoppingContext,
  parseShoppingFacts,
  validateCatalogIds,
} from './shopping-context'

describe('parseShoppingFacts', () => {
  it('returns empty context for junk facts', () => {
    expect(parseShoppingFacts(null).stage).toBe('discovery')
    expect(parseShoppingFacts('nope').selectedIds).toEqual([])
  })

  it('reads optional sales-summary fields without a migration', () => {
    const parsed = parseShoppingFacts({
      colors: ['red'],
      sizes: ['M'],
      comparisonIds: ['p-red', 'p-navy'],
      unresolvedQuestion: 'is this silk?',
      nextAction: 'ask_variant',
      stage: 'consideration',
    })
    expect(parsed.sizes).toEqual(['M'])
    expect(parsed.comparisonIds).toEqual(['p-red', 'p-navy'])
    expect(parsed.unresolvedQuestion).toBe('is this silk?')
    expect(parsed.nextAction).toBe('ask_variant')
  })
})

describe('mergeShoppingContext', () => {
  it('parses the second one, no red, and 7k as explicit constraints', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      text: 'show me something similar to the second one, no red, under 7k',
      shownIds: ['p-red', 'p-navy'],
      requirements: parseShoppingRequirements(
        'show me something similar to the second one, no red, under 7k',
      ),
    })
    expect(merged.selectedIds).toEqual(['p-navy'])
    expect(merged.dislikes).toContain('red')
    expect(merged.maxPrice).toBe(7000)
    expect(merged.shownIds).toEqual(['p-red', 'p-navy'])
  })

  it('keeps explicit dislikes over previously stored colors', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const previous = emptyShoppingContext()
    previous.colors = ['navy']
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous,
      text: "don't like navy",
    })
    expect(merged.dislikes).toContain('navy')
    expect(merged.colors).toEqual([])
  })

  it('replaces the previous color when the customer changes preference', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const previous = emptyShoppingContext()
    previous.colors = ['red']
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous,
      text: 'actually blue',
    })
    expect(merged.colors).toEqual(['blue'])
  })

  it('stores the latest size instead of appending', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const previous = emptyShoppingContext()
    previous.sizes = ['S']
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous,
      text: 'size M',
    })
    expect(merged.sizes).toEqual(['M'])
  })

  it('applies budget from a Malayalam under-price line', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      text: '₹3000 ഉള്ളിൽ',
    })
    expect(merged.maxPrice).toBe(3000)
  })

  it('updates both switch and budget from combined Malayalam text', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const previous = emptyShoppingContext()
    previous.selectedIds = ['p-red']
    previous.colors = ['red']
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous,
      text: '3000 രൂപയ്ക്കുള്ളിൽ വേറെ saree',
      rejectedIds: ['p-red'],
    })
    expect(merged.maxPrice).toBe(3000)
    expect(merged.rejectedIds).toContain('p-red')
    expect(merged.selectedIds).not.toContain('p-red')
  })

  it('formats a compact sales snapshot without inventing facts', () => {
    const shopping = emptyShoppingContext('consideration')
    shopping.maxPrice = 3000
    shopping.colors = ['blue']
    shopping.rejectedIds = ['p-red']
    shopping.categoryHint = 'saree'
    const snap = formatSalesSnapshot(shopping, {
      handle: 'pournami-blue',
      title: 'Pournami Blue',
    })
    expect(snap).toMatch(/budget_max: 3000/)
    expect(snap).toMatch(/colors: blue/)
    expect(snap).toMatch(/rejected_products: p-red/)
    expect(snap).toMatch(/current_product: Pournami Blue/)
    expect(snap).toMatch(/latest customer message overrides/i)
    expect(snap).not.toMatch(/wants to buy/i)
  })

  it('drops another account’s ids and invented titles', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      shownIds: ['p-b', 'not-a-real-product', 'p-red'],
      selectedIds: ['Pournami Red'],
    })
    expect(merged.shownIds).toEqual(['p-red'])
    expect(merged.selectedIds).toEqual([])
  })

  it('stays in memory when contact is missing', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const merged = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      text: 'wedding gift for my wife',
    })
    expect(merged.occasion).toBe('wedding')
    expect(merged.recipient).toBe('wife')
    expect(await loadShoppingContext(db, 'acct-a', null)).toEqual(
      emptyShoppingContext(),
    )
  })
})

describe('persistShoppingContext', () => {
  it('writes facts.shopping without treating LLM products as ids', async () => {
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      contact_ai_memory: [
        {
          account_id: 'acct-a',
          contact_id: 'c1',
          facts: { intent: 'buy', products: ['Invented Title'] },
        },
      ],
    })
    const shopping = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      shownIds: ['p-red'],
      text: 'this one',
    })
    await persistShoppingContext(db, 'acct-a', 'c1', shopping)
    const loaded = await loadShoppingContext(db, 'acct-a', 'c1')
    expect(loaded.selectedIds).toEqual(['p-red'])
    expect(loaded.shownIds).toEqual(['p-red'])
    const { data } = await db
      .from('contact_ai_memory')
      .select('facts')
      .eq('contact_id', 'c1')
      .maybeSingle()
    expect((data?.facts as { products?: string[] }).products).toEqual([
      'Invented Title',
    ])
  })
})

describe('validateCatalogIds', () => {
  it('preserves shown order for ordinals', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    expect(await validateCatalogIds(db, 'acct-a', ['p-navy', 'p-red'])).toEqual([
      'p-navy',
      'p-red',
    ])
  })
})
