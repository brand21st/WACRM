import { describe, expect, it, vi } from 'vitest'
import { intelSeed } from '../intelligence/facts.test'
import {
  applyCatalogHardFilters,
  reciprocalRankFusion,
  searchHybridCatalog,
} from './hybrid'
import { createCatalogMemoryDb } from './memory-db'
import { CATALOG_EMBEDDING_MODEL } from './embed-document'

const readyVectors = {
  catalog_product_embeddings: [
    {
      product_id: 'p-red',
      account_id: 'acct-a',
      status: 'ready',
      model: CATALOG_EMBEDDING_MODEL,
      embedding: '[0.1]',
    },
    {
      product_id: 'p-navy',
      account_id: 'acct-a',
      status: 'ready',
      model: CATALOG_EMBEDDING_MODEL,
      embedding: '[0.2]',
    },
    {
      product_id: 'p-gold',
      account_id: 'acct-a',
      status: 'ready',
      model: CATALOG_EMBEDDING_MODEL,
      embedding: '[0.3]',
    },
    {
      product_id: 'p-b',
      account_id: 'acct-b',
      status: 'ready',
      model: CATALOG_EMBEDDING_MODEL,
      embedding: '[0.9]',
    },
  ],
}

describe('reciprocalRankFusion', () => {
  it('boosts ids that appear in both lists', () => {
    expect(reciprocalRankFusion(['p-red', 'p-navy'], ['p-navy', 'p-gold'])[0]).toBe(
      'p-navy',
    )
  })
})

describe('applyCatalogHardFilters', () => {
  it('does not drop candidates when the store has no such attribute key', () => {
    const db = createCatalogMemoryDb(intelSeed())
    return searchHybridCatalog(db, { accountId: 'acct-a', text: 'bag', limit: 10 }).then(
      async (products) => {
        const kept = applyCatalogHardFilters(products, {
          accountId: 'acct-a',
          attribute: { key: 'occasion', value: 'wedding' },
        })
        expect(kept.length).toBeGreaterThan(0)
      },
    )
  })
})

describe('searchHybridCatalog', () => {
  it('returns exact handle lookup before semantic neighbors', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const semanticSearch = vi.fn(async () => ['p-gold'])
    const hits = await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'red-bag', status: 'active', limit: 5 },
      { mode: 'on', embeddingsApiKey: 'sk-test', semanticSearch },
    )
    expect(hits.map((product) => product.id)).toEqual(['p-red'])
    expect(semanticSearch).not.toHaveBeenCalled()
  })

  it('does not treat wedding as an exact SKU', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const semanticSearch = vi.fn(async () => ['p-gold'])
    const hits = await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'wedding', status: 'active', limit: 5 },
      { mode: 'on', embeddingsApiKey: 'sk-test', semanticSearch },
    )
    expect(semanticSearch).toHaveBeenCalled()
    expect(hits.some((product) => product.id === 'p-gold')).toBe(true)
  })

  it('does not relax a hard budget for semantic neighbors', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const hits = await searchHybridCatalog(
      db,
      {
        accountId: 'acct-a',
        text: 'bag',
        status: 'active',
        priceMax: 50,
        limit: 10,
      },
      {
        mode: 'on',
        embeddingsApiKey: 'sk-test',
        semanticSearch: async () => ['p-gold'],
      },
    )
    expect(hits.every((product) => (product.priceMin ?? 0) <= 50)).toBe(true)
    expect(hits.some((product) => product.id === 'p-gold')).toBe(false)
  })

  it('returns lexical results in shadow mode', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const lexical = await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'wedding', status: 'active', limit: 5 },
      { mode: 'off' },
    )
    const shadow = await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'wedding', status: 'active', limit: 5 },
      {
        mode: 'shadow',
        embeddingsApiKey: 'sk-test',
        semanticSearch: async () => ['p-gold'],
      },
    )
    expect(shadow.map((product) => product.id)).toEqual(
      lexical.map((product) => product.id),
    )
  })

  it('drops another account’s semantic id', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const hits = await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'wedding', status: 'active', limit: 5 },
      {
        mode: 'on',
        embeddingsApiKey: 'sk-test',
        semanticSearch: async () => ['p-b'],
      },
    )
    expect(hits.some((product) => product.id === 'p-b')).toBe(false)
  })

  it('stays lexical when the flag is off', async () => {
    const db = createCatalogMemoryDb({ ...intelSeed(), ...readyVectors })
    const semanticSearch = vi.fn(async () => ['p-gold'])
    await searchHybridCatalog(
      db,
      { accountId: 'acct-a', text: 'bag', status: 'active', limit: 5 },
      { mode: 'off', semanticSearch },
    )
    expect(semanticSearch).not.toHaveBeenCalled()
  })
})
