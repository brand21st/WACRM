import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueueCatalogEmbed = vi.fn().mockResolvedValue(true)

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueCatalogEmbed: (...args: unknown[]) => enqueueCatalogEmbed(...args),
}))

import { intelSeed } from '../intelligence/facts.test'
import { attachCatalogFacts } from '../intelligence/facts'
import { getProductById } from '../core/repository'
import {
  buildCatalogEmbedDocument,
  hashCatalogEmbedDocument,
} from '../search/embed-document'
import { createCatalogMemoryDb } from '../search/memory-db'
import { scheduleCatalogEmbed } from './jobs'

describe('scheduleCatalogEmbed', () => {
  beforeEach(() => {
    enqueueCatalogEmbed.mockReset().mockResolvedValue(true)
  })

  it('marks pending and enqueues when the hash is new', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    await scheduleCatalogEmbed(db, 'acct-a', 'p-red')
    expect(enqueueCatalogEmbed).toHaveBeenCalledWith({
      accountId: 'acct-a',
      productId: 'p-red',
    })
    const { data } = await db
      .from('catalog_product_embeddings')
      .select('status, model, dimensions')
      .eq('product_id', 'p-red')
      .maybeSingle()
    expect(data).toMatchObject({
      status: 'pending',
      model: 'text-embedding-3-small',
      dimensions: 1536,
    })
  })

  it('skips enqueue when a ready row already has the same hash', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const product = await getProductById(db, 'acct-a', 'p-red')
    const [facts] = await attachCatalogFacts(db, 'acct-a', [product!])
    const contentHash = hashCatalogEmbedDocument(
      buildCatalogEmbedDocument(facts ?? product!),
    )
    await db.from('catalog_product_embeddings').upsert(
      {
        product_id: 'p-red',
        account_id: 'acct-a',
        content_hash: contentHash,
        status: 'ready',
        model: 'text-embedding-3-small',
        dimensions: 1536,
      },
      { onConflict: 'product_id' },
    )
    await scheduleCatalogEmbed(db, 'acct-a', 'p-red')
    expect(enqueueCatalogEmbed).not.toHaveBeenCalled()
  })
})
