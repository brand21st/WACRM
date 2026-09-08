import { describe, expect, it, vi } from 'vitest'
import { intelSeed } from '../intelligence/facts.test'
import { CATALOG_EMBEDDING_MODEL } from './embed-document'
import { createCatalogMemoryDb } from './memory-db'
import {
  countReadyCatalogEmbeddings,
  loadCatalogHybridMode,
  matchCatalogSemantic,
} from './semantic'

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: vi.fn(async () => [[0.1, 0.2]]),
  toVectorLiteral: (vector: number[]) => `[${vector.join(',')}]`,
}))

describe('catalog semantic helpers', () => {
  it('defaults hybrid mode to off', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    expect(await loadCatalogHybridMode(db, 'acct-a')).toBe('off')
  })

  it('counts only ready or stale vectors for the account and model', async () => {
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      catalog_product_embeddings: [
        {
          product_id: 'p-red',
          account_id: 'acct-a',
          status: 'ready',
          model: CATALOG_EMBEDDING_MODEL,
        },
        {
          product_id: 'p-navy',
          account_id: 'acct-a',
          status: 'pending',
          model: CATALOG_EMBEDDING_MODEL,
        },
        {
          product_id: 'p-b',
          account_id: 'acct-b',
          status: 'ready',
          model: CATALOG_EMBEDDING_MODEL,
        },
      ],
    })
    expect(await countReadyCatalogEmbeddings(db, 'acct-a')).toBe(1)
  })

  it('scopes the match RPC to the requested account', async () => {
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      catalog_product_embeddings: [
        {
          product_id: 'p-red',
          account_id: 'acct-a',
          status: 'ready',
          model: CATALOG_EMBEDDING_MODEL,
          embedding: '[0.1]',
        },
        {
          product_id: 'p-b',
          account_id: 'acct-b',
          status: 'ready',
          model: CATALOG_EMBEDDING_MODEL,
          embedding: '[0.9]',
        },
        {
          product_id: 'p-oos',
          account_id: 'acct-a',
          status: 'failed',
          model: CATALOG_EMBEDDING_MODEL,
          embedding: '[0.2]',
        },
      ],
    })
    const ids = await matchCatalogSemantic(db, 'acct-a', 'bag', 'sk-test')
    expect(ids).toEqual(['p-red'])
  })
})
