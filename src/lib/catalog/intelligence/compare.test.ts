import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { compareCatalogProducts } from './compare'
import { UNAVAILABLE } from './types'
import { intelSeed } from './facts.test'

describe('compareCatalogProducts', () => {
  it('compares two products with price, variant, and attribute rows', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', ['p-red', 'p-navy'])
    expect(result.products.map((product) => product.id)).toEqual(['p-red', 'p-navy'])
    const price = result.comparison.rows.find((row) => row.field === 'price')
    expect(price?.values).toEqual(['INR 49', 'INR 55'])
    const compareAt = result.comparison.rows.find((row) => row.field === 'compare_at')
    expect(compareAt?.values[0]).toBe('69')
    expect(compareAt?.values[1]).toBe(UNAVAILABLE)
    const size = result.comparison.rows.find((row) => row.field === 'option:Size')
    expect(size?.values).toEqual(['M', 'M'])
    const material = result.comparison.rows.find((row) => row.field === 'attribute:Material')
    expect(material?.values).toEqual(['leather', 'leather'])
  })

  it('marks a missing attribute unavailable and notes it', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', ['red-bag', 'gold-bag'])
    const material = result.comparison.rows.find((row) => row.field === 'attribute:Material')
    expect(material?.values).toEqual(['leather', UNAVAILABLE])
    expect(result.comparison.notes.some((note) => /Gold Bag has no Material/.test(note))).toBe(
      true,
    )
  })

  it('caps at three products and notes omitted ids', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', [
      'p-red',
      'p-navy',
      'p-gold',
      'p-cheap',
    ])
    expect(result.products).toHaveLength(3)
    expect(result.comparison.notes).toContain('Compared the first 3 products only.')
  })

  it('rejects unknown ids and does not invent a pair', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', ['missing-1'])
    expect(result.products).toEqual([])
    expect(result.comparison.notes[0]).toMatch(/Need two catalog products/)
  })

  it('resolves names from query when ids are missing', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', [], 'red bag vs navy bag')
    expect(result.products.length).toBeGreaterThanOrEqual(2)
  })

  it('does not compare another account’s product', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    const result = await compareCatalogProducts(db, 'acct-a', ['p-red', 'p-b'])
    expect(result.products.map((product) => product.id)).toEqual(['p-red'])
    expect(result.comparison.notes[0]).toMatch(/Need two catalog products/)
  })
})
