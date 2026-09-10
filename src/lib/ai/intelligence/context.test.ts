import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyContactMemory } from '@/lib/ai/chat-memory';
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context';
import { buildAIContext } from './context';
import { emptyBusinessKnowledgeSnapshot } from './knowledge-contracts';

const db = {} as SupabaseClient;

describe('buildAIContext', () => {
  it('returns a typed bag from existing loaders without inventing patterns', async () => {
    const ctx = await buildAIContext(
      db,
      {
        accountId: 'acct-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        message: 'do you have a red saree?',
      },
      {
        loadAiConfig: vi.fn().mockResolvedValue(null),
        buildConversationContext: vi
          .fn()
          .mockResolvedValue([
            { role: 'user', content: 'do you have a red saree?' },
          ]),
        loadContactMemory: vi.fn().mockResolvedValue(emptyContactMemory()),
        loadShoppingContext: vi.fn().mockResolvedValue(emptyShoppingContext()),
        retrieveKnowledge: vi.fn().mockResolvedValue(['COD available.']),
        retrieveShopifyStoreContent: vi
          .fn()
          .mockResolvedValue(['Free shipping over 999.']),
        retrieveBusinessKnowledge: vi.fn().mockResolvedValue({
          ...emptyBusinessKnowledgeSnapshot('acct-1', 'do you have a red saree?'),
          results: [
            {
              id: 'manual_kb:doc',
              source: 'manual_kb',
              category: 'PAYMENT',
              confidence: 'high',
              excerpt: 'COD available.',
              ref: { documentId: 'doc' },
            },
          ],
        }),
      }
    );

    expect(ctx.accountId).toBe('acct-1');
    expect(ctx.message).toBe('do you have a red saree?');
    expect(ctx.knowledge).toEqual([
      'Free shipping over 999.',
      'COD available.',
    ]);
    expect(ctx.businessKnowledge.accountId).toBe('acct-1');
    expect(ctx.businessKnowledge.results[0]?.excerpt).toBe('COD available.');
    expect(ctx.salesPatterns).toEqual([]);
  });

  it('uses already-retrieved sales patterns and does not invent a query', async () => {
    const ctx = await buildAIContext(
      db,
      {
        accountId: 'acct-1',
        contactId: 'contact-1',
        conversationId: 'conv-1',
        message: 'too expensive',
      },
      {
        loadAiConfig: vi.fn().mockResolvedValue(null),
        buildConversationContext: vi.fn().mockResolvedValue([]),
        loadContactMemory: vi.fn().mockResolvedValue(emptyContactMemory()),
        loadShoppingContext: vi.fn().mockResolvedValue(emptyShoppingContext()),
        retrieveKnowledge: vi.fn().mockResolvedValue([]),
        retrieveShopifyStoreContent: vi.fn().mockResolvedValue([]),
        retrieveBusinessKnowledge: vi.fn().mockResolvedValue(
          emptyBusinessKnowledgeSnapshot('acct-1', 'too expensive')
        ),
        salesPatterns: [
          {
            accountId: 'acct-1',
            patternType: 'PRICE_OBJECTION',
            sourceContext: 'category:saree',
            confidence: 0.7,
            evidenceCount: 12,
            outcomeMetrics: { eligible: 10 },
            active: true,
            version: 1,
          },
        ],
      }
    );

    expect(ctx.salesPatterns).toHaveLength(1);
    expect(ctx.salesPatterns[0]?.patternType).toBe('PRICE_OBJECTION');
  });
});
