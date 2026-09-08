import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { intelSeed } from './facts.test'
import { listRelatedProducts, relatedIdsFor } from './relations'

describe('listRelatedProducts', () => {
  it('returns account-scoped relations for the requested kinds', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const similar = await listRelatedProducts(db, 'acct-a', 'p-red', ['similar'])
    expect(similar.map((product) => product.id)).toEqual(['p-gold'])
    const addons = await listRelatedProducts(db, 'acct-a', 'p-red', ['cross_sell'])
    expect(addons.map((product) => product.id)).toEqual(['p-cheap'])
  })

  it('returns an empty list when no relations exist', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    expect(await listRelatedProducts(db, 'acct-a', 'p-navy', ['similar'])).toEqual([])
  })

  it('does not return another account’s related product', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    expect(await listRelatedProducts(db, 'acct-b', 'p-red', ['similar'])).toEqual([])
    expect(await relatedIdsFor(db, 'acct-b', 'p-red', ['similar'])).toEqual(new Set())
  })
})
