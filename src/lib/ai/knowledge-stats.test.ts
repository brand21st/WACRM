import { describe, expect, it } from 'vitest'

import {
  bucketIndex,
  classifyDocumentBucket,
  computeKnowledgeScore,
  emptyBreakdown,
} from '@/lib/ai/knowledge-stats'

describe('classifyDocumentBucket', () => {
  it('routes Shopify product docs to shopify_products', () => {
    expect(
      classifyDocumentBucket('[Shopify Product] Teddy', null),
    ).toBe('shopify_products')
  })

  it('routes Shopify pages and policies using store kind map', () => {
    const map = new Map<string, 'policy' | 'page'>([
      ['Refund policy', 'policy'],
      ['About us', 'page'],
    ])
    expect(classifyDocumentBucket('[Shopify] Refund policy', null, map)).toBe(
      'shopify_policies',
    )
    expect(classifyDocumentBucket('[Shopify] About us', null, map)).toBe(
      'shopify_pages',
    )
  })

  it('routes scraped URLs to website and everything else to manual', () => {
    expect(classifyDocumentBucket('FAQ', 'url')).toBe('website')
    expect(classifyDocumentBucket('Returns', 'manual')).toBe('manual')
  })
})

describe('computeKnowledgeScore', () => {
  it('returns ~0 for an empty knowledge base', () => {
    const result = computeKnowledgeScore({
      has_embeddings_key: false,
      total_chunks: 0,
      embedded_chunks: 0,
      breakdown: emptyBreakdown(),
    })
    expect(result.score).toBe(0)
    expect(result.total_indexed_chars).toBe(0)
    expect(result.embedding_coverage_pct).toBe(0)
  })

  it('caps volume at 40 points and awards breadth per indexed bucket', () => {
    const breakdown = emptyBreakdown()
    const products = bucketIndex(breakdown, 'shopify_products')
    products.items = 10
    products.indexed_items = 10
    products.characters = 60_000
    products.chunks = 40

    const manual = bucketIndex(breakdown, 'manual')
    manual.items = 2
    manual.indexed_items = 2
    manual.characters = 5_000
    manual.chunks = 10

    const result = computeKnowledgeScore({
      has_embeddings_key: false,
      total_chunks: 50,
      embedded_chunks: 0,
      breakdown,
    })

    expect(result.total_indexed_chars).toBe(65_000)
    expect(result.score).toBeGreaterThanOrEqual(70)
    expect(result.score).toBeLessThanOrEqual(82)
  })

  it('adds embedding coverage when an embeddings key is configured', () => {
    const breakdown = emptyBreakdown()
    const website = bucketIndex(breakdown, 'website')
    website.items = 1
    website.indexed_items = 1
    website.characters = 10_000
    website.chunks = 20

    const without = computeKnowledgeScore({
      has_embeddings_key: false,
      total_chunks: 20,
      embedded_chunks: 0,
      breakdown,
    })
    const withEmbeddings = computeKnowledgeScore({
      has_embeddings_key: true,
      total_chunks: 20,
      embedded_chunks: 10,
      breakdown,
    })

    expect(withEmbeddings.embedding_coverage_pct).toBe(50)
    expect(withEmbeddings.score).toBeGreaterThan(without.score)
  })
})
