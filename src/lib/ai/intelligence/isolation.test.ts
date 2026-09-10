import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { emptyContactMemory } from '@/lib/ai/chat-memory';
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context';
import { buildAIContext } from './context';
import {
  analyzeJobIdempotencyKey,
  assertRetrievalQuery,
  MissingAccountIdError,
  requireAccountId,
  type ConversationAnalyzeJob,
  type RetrievalQuery,
  type SalesPattern,
} from './contracts';

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }));
vi.mock('@/lib/ai/embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}));

function knowledgeDb() {
  const rpcArgs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const eqCalls: Array<[string, unknown]> = [];
  const db = {
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcArgs.push({ name, params });
      return Promise.resolve({ data: [], error: null });
    },
    from: () => ({
      select: () => ({
        eq: (col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return Promise.resolve({ count: 2, error: null });
        },
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient, rpcArgs, eqCalls };
}

describe('requireAccountId', () => {
  it('returns a trimmed tenant id', () => {
    expect(requireAccountId('  acct-1  ')).toBe('acct-1');
  });

  it('rejects missing, blank, and non-string ids before any query', () => {
    expect(() => requireAccountId(undefined)).toThrow(MissingAccountIdError);
    expect(() => requireAccountId(null)).toThrow(MissingAccountIdError);
    expect(() => requireAccountId('')).toThrow(MissingAccountIdError);
    expect(() => requireAccountId('   ')).toThrow(MissingAccountIdError);
  });
});

describe('RetrievalQuery', () => {
  it('requires accountId as the first filter', () => {
    const query: RetrievalQuery = {
      accountId: 'acct-a',
      layer: 'business_knowledge',
      query: 'return policy',
    };
    expect(assertRetrievalQuery(query).accountId).toBe('acct-a');
  });

  it('rejects a retrieve that omitted the tenant', () => {
    expect(() =>
      assertRetrievalQuery({
        accountId: '',
        layer: 'sales_pattern',
        query: 'too expensive',
      })
    ).toThrow(/retrieve sales_pattern/);
  });
});

describe('ConversationAnalyzeJob', () => {
  it('requires accountId on the payload and idempotency key', () => {
    const job: ConversationAnalyzeJob = {
      accountId: 'acct-a',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      triggeringMessageId: 'msg-9',
      idempotencyKey: analyzeJobIdempotencyKey({
        accountId: 'acct-a',
        conversationId: 'conv-1',
        triggeringMessageId: 'msg-9',
      }),
    };
    expect(job.accountId).toBe('acct-a');
    expect(job.idempotencyKey).toBe('acct-a:conv-1:msg-9');
  });

  it('refuses an analyze job without accountId', () => {
    expect(() =>
      analyzeJobIdempotencyKey({
        accountId: '',
        conversationId: 'conv-1',
        triggeringMessageId: 'msg-9',
      })
    ).toThrow(MissingAccountIdError);
  });
});

describe('SalesPattern tenant scope', () => {
  it('types a pattern as account-owned, never global', () => {
    const pattern: SalesPattern = {
      accountId: 'acct-a',
      patternType: 'price_objection_alternative',
      sourceContext: 'too expensive',
      confidence: 0.4,
      evidenceCount: 3,
      outcomeMetrics: { purchase_completed: 1 },
      active: true,
      version: 1,
    };
    expect(pattern.accountId).toBeTruthy();
  });
});

describe('retrieveKnowledge tenant boundary', () => {
  it('scopes the empty-KB guard and RPCs with p_account_id', async () => {
    h.embedTexts.mockResolvedValue([[0.1, 0.2]]);
    const { db, rpcArgs, eqCalls } = knowledgeDb();
    await retrieveKnowledge(
      db,
      'acct-a',
      { embeddingsApiKey: 'sk-x' },
      'saree under 5000'
    );

    expect(eqCalls).toContainEqual(['account_id', 'acct-a']);
    expect(rpcArgs.length).toBeGreaterThan(0);
    for (const call of rpcArgs) {
      expect(call.params.p_account_id).toBe('acct-a');
    }
  });

  it('never issues a global knowledge RPC', async () => {
    h.embedTexts.mockResolvedValue([[0.1]]);
    const { db, rpcArgs } = knowledgeDb();
    await retrieveKnowledge(
      db,
      'acct-b',
      { embeddingsApiKey: null },
      'shipping'
    );
    expect(rpcArgs.every((call) => call.params.p_account_id === 'acct-b')).toBe(
      true
    );
    expect(rpcArgs.some((call) => !('p_account_id' in call.params))).toBe(
      false
    );
  });
});

describe('buildAIContext isolation', () => {
  const unusedDb = {} as SupabaseClient;

  it('throws before calling loaders when accountId is missing', async () => {
    const loadContactMemory = vi.fn();
    const retrieveKnowledgeFn = vi.fn();
    await expect(
      buildAIContext(
        unusedDb,
        { accountId: '', contactId: 'c1', conversationId: 'v1', message: 'hi' },
        {
          loadContactMemory,
          retrieveKnowledge: retrieveKnowledgeFn,
          loadAiConfig: vi.fn(),
          buildConversationContext: vi.fn(),
          loadShoppingContext: vi.fn(),
          retrieveShopifyStoreContent: vi.fn(),
        }
      )
    ).rejects.toBeInstanceOf(MissingAccountIdError);
    expect(loadContactMemory).not.toHaveBeenCalled();
    expect(retrieveKnowledgeFn).not.toHaveBeenCalled();
  });

  it('passes the same accountId into every tenant loader', async () => {
    const seen: string[] = [];
    const ctx = await buildAIContext(
      unusedDb,
      {
        accountId: 'acct-a',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        message: 'red saree',
      },
      {
        loadAiConfig: async (_db, accountId) => {
          seen.push(`config:${accountId}`);
          return null;
        },
        buildConversationContext: async () => [
          { role: 'user', content: 'red saree' },
        ],
        loadContactMemory: async (_db, accountId, contactId) => {
          seen.push(`memory:${accountId}:${contactId}`);
          return {
            profileSummary: '',
            lastSessionSummary: '',
            facts: {
              intent: null,
              products: [],
              preferences: [],
              language: null,
              language_code: null,
              language_script: null,
              language_locked: false,
              open_questions: [],
            },
            notes: [],
            summarizedThroughAt: null,
            messageCountAtSummary: 0,
            conversationId: 'conv-1',
          };
        },
        loadShoppingContext: async (_db, accountId, contactId) => {
          seen.push(`shopping:${accountId}:${contactId}`);
          return {
            colors: ['red'],
            sizes: [],
            dislikes: [],
            selectedIds: [],
            rejectedIds: [],
            shownIds: [],
            stage: 'discovery',
          };
        },
        retrieveKnowledge: async (_db, accountId) => {
          seen.push(`knowledge:${accountId}`);
          return ['Returns within 7 days.'];
        },
        retrieveShopifyStoreContent: async (_db, accountId) => {
          seen.push(`store:${accountId}`);
          return [];
        },
        retrieveBusinessKnowledge: async (_db, query) => {
          seen.push(`business:${query.accountId}`);
          return {
            accountId: query.accountId,
            query: query.query,
            results: [],
            conflicts: [],
            catalogProductIds: [],
            fetchedAt: new Date(0).toISOString(),
          };
        },
      }
    );

    expect(seen.sort()).toEqual([
      'business:acct-a',
      'config:acct-a',
      'knowledge:acct-a',
      'memory:acct-a:contact-1',
      'shopping:acct-a:contact-1',
      'store:acct-a',
    ]);
    expect(ctx.accountId).toBe('acct-a');
    expect(ctx.knowledge).toEqual(['Returns within 7 days.']);
    expect(ctx.businessKnowledge.accountId).toBe('acct-a');
    expect(ctx.salesPatterns).toEqual([]);
    expect(ctx.salesSnapshot).toContain('colors: red');
    expect(seen.some((item) => item.startsWith('patterns:'))).toBe(false);
  });

  it('attaches injected sales patterns without querying sales_patterns', async () => {
    const ctx = await buildAIContext(
      unusedDb,
      {
        accountId: 'acct-a',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        message: 'too expensive',
      },
      {
        loadAiConfig: async () => null,
        buildConversationContext: async () => [],
        loadContactMemory: async () => emptyContactMemory(),
        loadShoppingContext: async () => emptyShoppingContext(),
        retrieveKnowledge: async () => [],
        retrieveShopifyStoreContent: async () => [],
        retrieveBusinessKnowledge: async () => ({
          accountId: 'acct-a',
          query: 'too expensive',
          results: [],
          conflicts: [],
          catalogProductIds: [],
          fetchedAt: new Date(0).toISOString(),
        }),
        salesPatterns: [
          {
            accountId: 'acct-a',
            patternType: 'PRICE_OBJECTION',
            sourceContext: 'category:saree',
            confidence: 0.6,
            evidenceCount: 8,
            outcomeMetrics: { eligible: 5 },
            active: true,
            version: 1,
          },
        ],
      }
    );
    expect(ctx.salesPatterns).toHaveLength(1);
    expect(ctx.salesPatterns[0]?.accountId).toBe('acct-a');
  });

  it('swallows loader failures so chat context still returns', async () => {
    const ctx = await buildAIContext(
      unusedDb,
      {
        accountId: 'acct-a',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        message: 'hello',
      },
      {
        loadAiConfig: async () => {
          throw new Error('platform down');
        },
        buildConversationContext: async () => {
          throw new Error('messages down');
        },
        loadContactMemory: async () => {
          throw new Error('memory down');
        },
        loadShoppingContext: async () => {
          throw new Error('shopping down');
        },
        retrieveKnowledge: async () => {
          throw new Error('kb down');
        },
        retrieveShopifyStoreContent: async () => {
          throw new Error('store down');
        },
        retrieveBusinessKnowledge: async () => {
          throw new Error('business knowledge down');
        },
      }
    );
    expect(ctx.messages).toEqual([]);
    expect(ctx.knowledge).toEqual([]);
    expect(ctx.salesPatterns).toEqual([]);
    expect(ctx.businessKnowledge.results).toEqual([]);
    expect(ctx.memory.profileSummary).toBe('');
  });
});
