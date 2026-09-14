import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import {
  retrieveKnowledge,
  ingestDocument,
  lexicalSearchQuery,
  ftsWebsearchQuery,
  titledIngestContent,
  isCompanyIntent,
  isContactIntent,
  isFaqIntent,
  mergeKnowledgeSources,
} from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  fallback: { id: string; content: string }[]
  contactDocs: { id: string; title: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  ftsQuery: string | null
  inserted: Record<string, unknown>[] | null
  deletedFor: string | null
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    fallback: [],
    contactDocs: [],
    chunkCount: 5, // account has a non-empty KB by default
    rpcCalls: [],
    ftsQuery: null,
    inserted: null,
    deletedFor: null,
  }
  const db = {
    rpc: (name: string, args?: { p_query?: string }) => {
      state.rpcCalls.push(name)
      if (name === 'match_ai_knowledge_fts' && args?.p_query != null) {
        state.ftsQuery = args.p_query
      }
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts')
        return Promise.resolve({ data: state.fts, error: null })
      if (name === 'match_ai_knowledge_fallback')
        return Promise.resolve({ data: state.fallback, error: null })
      return Promise.resolve({ data: null, error: null })
    },
    from: (table: string) => {
      if (table === 'ai_knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: state.contactDocs, error: null }),
              or: () => ({
                limit: () => Promise.resolve({ data: state.contactDocs, error: null }),
              }),
            }),
          }),
        }
      }
      return {
        // retrieveKnowledge's empty-KB count guard.
        select: () => ({
          eq: () => Promise.resolve({ count: state.chunkCount, error: null }),
        }),
        delete: () => ({
          eq: (_col: string, val: string) => {
            state.deletedFor = val
            return Promise.resolve({ error: null })
          },
        }),
        insert: (rows: Record<string, unknown>[]) => {
          state.inserted = rows
          return Promise.resolve({ error: null })
        },
      }
    },
  }
  return { db: db as unknown as SupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    // Enough semantic hits → no FTS top-up.
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' }, // dedup by id
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'F1'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })

  it('uses the fallback RPC when FTS is empty for a company question', async () => {
    const { db, state } = makeDb()
    state.fallback = [{ id: 'about', content: 'About Acme: we make bags.' }]
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'tell me about the company',
    )
    expect(out).toEqual(['About Acme: we make bags.'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_fts',
      'match_ai_knowledge_fallback',
    ])
  })

  it('rewrites a contact question so FTS is not AND-blocked by give/number', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'c1', content: 'Please contact us at 95441 61100' }]
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'Give your contact number',
    )
    expect(state.ftsQuery).toMatch(/contact/)
    expect(state.ftsQuery).toMatch(/OR/)
    expect(out[0]).toContain('95441 61100')
  })

  it('puts a titled contact document ahead of unrelated FTS product chunks', async () => {
    const { db, state } = makeDb()
    state.fts = [
      { id: 'p1', content: 'Red tote bag in stock' },
      { id: 'p2', content: 'Blue sling bag' },
      { id: 'p3', content: 'Canvas backpack' },
      { id: 'p4', content: 'Laptop sleeve' },
      { id: 'p5', content: 'Coin purse' },
    ]
    state.contactDocs = [
      {
        id: 'care',
        title: 'customer care number',
        content: 'Customer Care: please contact us at 95441 61100',
        source_type: 'manual',
      },
    ]
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'Give your contact number',
      5,
    )
    expect(out[0]).toContain('95441 61100')
    expect(out[0].toLowerCase()).toContain('customer care')
    expect(out.some((excerpt) => /tote|sling|backpack|laptop|purse/i.test(excerpt))).toBe(
      false,
    )
    expect(state.rpcCalls).toEqual([])
  })

  it('returns a titled hours document for “what time are you open”', async () => {
    const { db, state } = makeDb()
    state.contactDocs = [
      {
        id: 'hours',
        title: 'Store hours',
        content: 'We are open Monday to Saturday, 9am to 7pm. Closed on Sundays.',
        source_type: 'manual',
      },
    ]
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'what time are you open',
    )
    expect(out[0]).toContain('9am to 7pm')
    expect(state.rpcCalls).toEqual([])
  })

  it('returns a COD policy from a titled FAQ document', async () => {
    const { db, state } = makeDb()
    state.contactDocs = [
      {
        id: 'care',
        title: 'customer care number',
        content: 'Cash on Delivery (COD): available for all prepaid-failed orders.',
        source_type: 'manual',
      },
    ]
    const out = await retrieveKnowledge(
      db,
      'acct',
      { embeddingsApiKey: null },
      'do you have COD',
    )
    expect(out[0]).toMatch(/COD/i)
  })
})

describe('lexical helpers', () => {
  it('drops conversational stopwords', () => {
    expect(lexicalSearchQuery('tell me about the company')).toBe('company')
  })

  it('detects company intent', () => {
    expect(isCompanyIntent('tell me about the company')).toBe(true)
    expect(isCompanyIntent('what size is the red bag')).toBe(false)
  })

  it('detects contact-number intent and expands FTS with OR synonyms', () => {
    expect(isContactIntent('Give your contact number')).toBe(true)
    expect(isContactIntent('customer care number')).toBe(true)
    expect(isContactIntent('what size is the red bag')).toBe(false)
    expect(isFaqIntent('what time are you open')).toBe(true)
    expect(isFaqIntent('do you have COD')).toBe(true)
    expect(lexicalSearchQuery('Give your contact number')).toBe('contact number')
    expect(ftsWebsearchQuery('Give your contact number')).toMatch(/contact/)
    expect(ftsWebsearchQuery('Give your contact number')).toMatch(/OR/)
    expect(ftsWebsearchQuery('whatsapp number please')).toMatch(/whatsapp/)
  })

  it('puts manual knowledge first for a contact question', () => {
    expect(
      mergeKnowledgeSources(
        'Give your contact number',
        ['Page: Contact\n', 'Policy: Shipping\nWhatsApp us on 9544161100 for dispatch help.'],
        ['Customer Care: 95441 61100'],
      ),
    ).toEqual([
      'Customer Care: 95441 61100',
      'Policy: Shipping\nWhatsApp us on 9544161100 for dispatch help.',
    ])
  })

  it('prefixes a title onto ingest content', () => {
    expect(titledIngestContent('We make bags.', 'About Acme')).toBe(
      'About Acme\n\nWe make bags.',
    )
    expect(titledIngestContent('About Acme\n\nWe make bags.', 'About Acme')).toBe(
      'About Acme\n\nWe make bags.',
    )
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(
      db,
      'acct',
      { embeddingsApiKey: 'sk-x' },
      'doc-1',
      'hello world',
      'Greeting',
    )
    expect(state.inserted![0].content).toContain('Greeting')
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]') // literal from mocked embed
    expect(state.inserted![0].account_id).toBe('acct')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world'),
    ).rejects.toThrow('rate limited')
    // Chunks were inserted (lexical search works) despite the embed failure…
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })
})
