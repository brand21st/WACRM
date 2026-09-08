import { beforeEach, describe, expect, it, vi } from 'vitest'

const embedTexts = vi.fn()
const loadEmbeddingsKey = vi.fn()

vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: (...args: unknown[]) => embedTexts(...args),
  toVectorLiteral: (vector: number[]) => `[${vector.join(',')}]`,
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: (...args: unknown[]) => loadEmbeddingsKey(...args),
}))

import { intelSeed } from '../intelligence/facts.test'
import { createCatalogMemoryDb } from '../search/memory-db'
import { generateCatalogProductEmbedding } from './generate'

describe('generateCatalogProductEmbedding', () => {
  beforeEach(() => {
    embedTexts.mockReset()
    loadEmbeddingsKey.mockReset()
  })

  it('writes a ready vector from the platform embeddings key', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    loadEmbeddingsKey.mockResolvedValue({ key: 'sk-test' })
    embedTexts.mockResolvedValue([[0.1, 0.2]])
    await generateCatalogProductEmbedding(db, 'acct-a', 'p-red')
    expect(embedTexts).toHaveBeenCalledWith(
      'sk-test',
      [expect.stringContaining('Red Bag')],
      'text-embedding-3-small',
    )
    const { data } = await db
      .from('catalog_product_embeddings')
      .select('status, embedding, error')
      .eq('product_id', 'p-red')
      .maybeSingle()
    expect(data).toMatchObject({
      status: 'ready',
      embedding: '[0.1,0.2]',
      error: null,
    })
  })

  it('marks failed when no embeddings key is configured', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    loadEmbeddingsKey.mockResolvedValue({ key: null })
    await generateCatalogProductEmbedding(db, 'acct-a', 'p-red')
    expect(embedTexts).not.toHaveBeenCalled()
    const { data } = await db
      .from('catalog_product_embeddings')
      .select('status, error')
      .eq('product_id', 'p-red')
      .maybeSingle()
    expect(data?.status).toBe('failed')
    expect(String(data?.error)).toMatch(/No embeddings key/)
  })
})
