import { describe, expect, it } from 'vitest'
import type { ShopifyProductCard } from '@/lib/shopify'

import {
  loadCatalogCardQueue,
  parseCatalogCardQueue,
  persistCatalogCardQueue,
} from './catalog-card-queue'

function card(n: number): ShopifyProductCard {
  return {
    title: `Item ${n}`,
    imageUrl: `https://cdn.example/${n}.jpg`,
    productUrl: `https://shop.example/products/${n}`,
    cartUrl: null,
    checkoutUrl: null,
    inStock: true,
    caption: `Item ${n}`,
    handle: `item-${n}`,
  }
}

function memoryDb(initialFacts: Record<string, unknown> | null = null) {
  let facts = initialFacts
  const upserts: Record<string, unknown>[] = []
  const db = {
    from: (table: string) => {
      if (table !== 'contact_ai_memory') throw new Error(table)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: facts ? { facts } : null,
                error: null,
              }),
            }),
          }),
        }),
        upsert: async (row: Record<string, unknown>) => {
          upserts.push(row)
          facts = (row.facts as Record<string, unknown>) ?? {}
          return { error: null }
        },
      }
    },
  }
  return { db: db as never, upserts, getFacts: () => facts }
}

describe('parseCatalogCardQueue', () => {
  it('returns null for junk', () => {
    expect(parseCatalogCardQueue(null)).toBeNull()
    expect(parseCatalogCardQueue('nope')).toBeNull()
    expect(parseCatalogCardQueue({ cards: [] })).toBeNull()
  })

  it('keeps valid cards and drops incomplete ones', () => {
    const parsed = parseCatalogCardQueue({
      conversationId: 'conv-1',
      cards: [card(1), { title: 'Nope' }, card(2)],
    })
    expect(parsed?.conversationId).toBe('conv-1')
    expect(parsed?.cards.map((c) => c.title)).toEqual(['Item 1', 'Item 2'])
  })
})

describe('catalog card queue persist', () => {
  it('stores remaining cards keyed by conversation', async () => {
    const { db, getFacts } = memoryDb({ shopping: { stage: 'discovery' } })
    await persistCatalogCardQueue(db, 'acct-1', 'c1', 'conv-1', [card(11), card(12)])
    const facts = getFacts()
    expect(facts?.shopping).toEqual({ stage: 'discovery' })
    expect(parseCatalogCardQueue(facts?.catalogCardQueue)?.cards).toHaveLength(2)
  })

  it('loads only when conversationId matches and clears on empty persist', async () => {
    const { db } = memoryDb({
      catalogCardQueue: { conversationId: 'conv-1', cards: [card(11)] },
    })
    expect(await loadCatalogCardQueue(db, 'acct-1', 'c1', 'conv-1')).toHaveLength(1)
    expect(await loadCatalogCardQueue(db, 'acct-1', 'c1', 'conv-other')).toEqual([])
    await persistCatalogCardQueue(db, 'acct-1', 'c1', 'conv-1', [])
    expect(await loadCatalogCardQueue(db, 'acct-1', 'c1', 'conv-1')).toEqual([])
  })
})
