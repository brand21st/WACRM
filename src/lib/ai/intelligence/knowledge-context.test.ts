import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MissingAccountIdError } from './contracts';
import {
  buildBusinessKnowledgeSnapshot,
  retrieveBusinessKnowledge,
} from './knowledge-context';
import type { KnowledgeResult } from './knowledge-contracts';

const db = {} as SupabaseClient;

describe('retrieveBusinessKnowledge isolation', () => {
  it('throws before calling loaders when accountId is missing', async () => {
    const loadKnowledgeHits = vi.fn();
    const searchStoreContent = vi.fn();
    const searchCatalog = vi.fn();
    await expect(
      retrieveBusinessKnowledge(
        db,
        { accountId: '', query: 'return policy' },
        { loadKnowledgeHits, searchStoreContent, searchCatalog }
      )
    ).rejects.toBeInstanceOf(MissingAccountIdError);
    expect(loadKnowledgeHits).not.toHaveBeenCalled();
    expect(searchStoreContent).not.toHaveBeenCalled();
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it('passes only the requested accountId into every source loader', async () => {
    const seen: string[] = [];
    await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'return policy', contactId: 'c1' },
      {
        loadAiConfig: async (_db, accountId) => {
          seen.push(`config:${accountId}`);
          return null;
        },
        loadKnowledgeHits: async (_db, accountId) => {
          seen.push(`kb:${accountId}`);
          return [
            {
              chunkId: 'ch1',
              documentId: 'doc1',
              title: 'Returns',
              content: 'Return within 7 days.',
              sourceType: 'manual',
            },
          ];
        },
        searchStoreContent: async (_db, accountId) => {
          seen.push(`store:${accountId}`);
          return [];
        },
        searchCatalog: async (_db, args) => {
          seen.push(`catalog:${args.accountId}`);
          return [];
        },
      }
    );
    expect(seen.sort()).toEqual([
      'catalog:acct-a',
      'config:acct-a',
      'kb:acct-a',
      'store:acct-a',
    ]);
  });

  it('drops catalog rows that belong to another account', async () => {
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'red saree' },
      {
        loadAiConfig: async () => null,
        loadKnowledgeHits: async () => [],
        searchStoreContent: async () => [],
        searchCatalog: async () => [
          { id: 'p-b', accountId: 'acct-b', title: 'Leaked saree', priceMin: 1 },
          { id: 'p-a', accountId: 'acct-a', title: 'Red silk saree', priceMin: 4999 },
        ],
      }
    );
    expect(snap.catalogProductIds).toEqual(['p-a']);
    expect(snap.results.every((row) => row.ref.productId !== 'p-b')).toBe(true);
  });
});

describe('retrieveBusinessKnowledge snapshot', () => {
  it('returns an empty snapshot when every source is missing', async () => {
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'return policy' },
      {
        loadAiConfig: async () => {
          throw new Error('config down');
        },
        loadKnowledgeHits: async () => {
          throw new Error('kb down');
        },
        searchStoreContent: async () => {
          throw new Error('store down');
        },
        searchCatalog: async () => {
          throw new Error('catalog down');
        },
      }
    );
    expect(snap.accountId).toBe('acct-a');
    expect(snap.results).toEqual([]);
    expect(snap.conflicts).toEqual([]);
    expect(snap.catalogProductIds).toEqual([]);
  });

  it('returns an empty snapshot for a blank query without hitting sources', async () => {
    const loadKnowledgeHits = vi.fn();
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: '   ' },
      { loadKnowledgeHits }
    );
    expect(snap.results).toEqual([]);
    expect(loadKnowledgeHits).not.toHaveBeenCalled();
  });

  it('prefers manual KB over a conflicting store page', async () => {
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'return policy' },
      {
        loadAiConfig: async () => null,
        loadKnowledgeHits: async () => [
          {
            chunkId: 'ch1',
            documentId: 'doc1',
            title: 'Returns',
            content: 'Return within 7 days.',
            sourceType: 'manual',
          },
        ],
        searchStoreContent: async () => [
          {
            kind: 'page',
            title: 'Returns',
            handle: 'returns',
            body: 'Return within 15 days.',
            pageUrl: null,
          },
        ],
        searchCatalog: async () => [],
      }
    );
    expect(snap.results.map((row) => row.excerpt)).toEqual([
      'Return within 7 days.',
    ]);
    expect(snap.conflicts[0]?.unresolved).toBe(false);
    expect(snap.results.some((row) => row.source === 'generic_model')).toBe(
      false
    );
  });

  it('keeps same-rank conflicts unresolved', async () => {
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'return window' },
      {
        loadAiConfig: async () => null,
        loadKnowledgeHits: async () => [
          {
            chunkId: 'ch1',
            documentId: 'doc1',
            title: 'Returns',
            content: 'Return within 7 days.',
            sourceType: 'url',
          },
        ],
        searchStoreContent: async () => [
          {
            kind: 'page',
            title: 'Returns',
            handle: 'returns',
            body: 'Return within 15 days.',
            pageUrl: null,
          },
        ],
        searchCatalog: async () => [],
      }
    );
    expect(snap.results).toHaveLength(2);
    expect(snap.conflicts[0]?.unresolved).toBe(true);
  });

  it('filters to an explicit category', async () => {
    const snap = await retrieveBusinessKnowledge(
      db,
      { accountId: 'acct-a', query: 'help', category: 'PAYMENT' },
      {
        loadAiConfig: async () => null,
        loadKnowledgeHits: async () => [
          {
            chunkId: 'ch1',
            documentId: 'doc1',
            title: 'Payments',
            content: 'We accept UPI and COD.',
            sourceType: 'manual',
          },
          {
            chunkId: 'ch2',
            documentId: 'doc2',
            title: 'Returns',
            content: 'Return within 7 days.',
            sourceType: 'manual',
          },
        ],
        searchStoreContent: async () => [],
        searchCatalog: async () => [],
      }
    );
    expect(snap.results).toHaveLength(1);
    expect(snap.results[0].category).toBe('PAYMENT');
  });

  it('never includes generic_model results', async () => {
    const snap = buildBusinessKnowledgeSnapshot({
      accountId: 'acct-a',
      query: 'x',
      results: [
        {
          id: 'generic_model:x',
          source: 'generic_model',
          category: 'OTHER',
          confidence: 'unknown',
          excerpt: 'made up',
          ref: {},
        } satisfies KnowledgeResult,
      ],
    });
    // Composer maps never emit generic_model; snapshot still must not
    // treat it as catalog truth.
    expect(snap.catalogProductIds).toEqual([]);
  });
});

describe('default knowledge RPC scoping', () => {
  it('sends p_account_id and joins documents by account_id', async () => {
    const rpcArgs: Array<{ name: string; params: Record<string, unknown> }> = [];
    const eqCalls: Array<[string, string, unknown]> = [];
    const fakeDb = {
      rpc: (name: string, params: Record<string, unknown>) => {
        rpcArgs.push({ name, params });
        return Promise.resolve({
          data: [{ id: 'chunk-1', content: 'Return within 7 days.' }],
          error: null,
        });
      },
      from: (table: string) => ({
        select: () => ({
          eq: (col: string, val: unknown) => {
            eqCalls.push([table, col, val]);
            if (table === 'ai_knowledge_chunks' && col === 'account_id') {
              return {
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'chunk-1',
                        document_id: 'doc-1',
                        content: 'Return within 7 days.',
                      },
                    ],
                    error: null,
                  }),
                then: (
                  resolve: (value: { count: number; error: null }) => void
                ) => resolve({ count: 1, error: null }),
              };
            }
            if (table === 'ai_knowledge_documents' && col === 'account_id') {
              return {
                in: () =>
                  Promise.resolve({
                    data: [
                      {
                        id: 'doc-1',
                        title: 'Returns',
                        source_type: 'manual',
                        updated_at: '2026-01-01T00:00:00.000Z',
                      },
                    ],
                    error: null,
                  }),
              };
            }
            return Promise.resolve({ count: 0, error: null });
          },
        }),
      }),
    };

    const snap = await retrieveBusinessKnowledge(
      fakeDb as unknown as SupabaseClient,
      { accountId: 'acct-a', query: 'return policy' },
      {
        searchStoreContent: async () => [],
        searchCatalog: async () => [],
      }
    );

    expect(rpcArgs.every((call) => call.params.p_account_id === 'acct-a')).toBe(
      true
    );
    expect(eqCalls.some((call) => call[0] === 'ai_knowledge_chunks' && call[2] === 'acct-a')).toBe(
      true
    );
    expect(
      eqCalls.some(
        (call) => call[0] === 'ai_knowledge_documents' && call[2] === 'acct-a'
      )
    ).toBe(true);
    expect(snap.results[0]?.source).toBe('manual_kb');
    expect(snap.results[0]?.ref.documentId).toBe('doc-1');
  });
});
