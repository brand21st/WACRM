import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { observeSalesPatternsInBackground } from './observe-sales-patterns';

const db = {} as SupabaseClient;
const sourceTurnId = '00000000-0000-5000-8000-000000000001';

describe('background sales-pattern observation', () => {
  it('observes a shadow turn with tenant-scoped, PII-free diagnostics', async () => {
    const retrieve = vi.fn().mockResolvedValue([
      {
        patternId: 'pattern-1',
        patternType: 'PRICE_OBJECTION',
        triggerEventType: 'PRICE_OBJECTION',
        context: {},
        recommendedBehavior: 'OFFER_RELEVANT_ALTERNATIVE',
        confidence: 0.7,
        sampleCount: 12,
        eligibleOutcomeCount: 10,
        successRate: 0.6,
        matchScore: 55,
        matchReasons: ['patternType'],
      },
    ]);
    const log = vi.fn();
    const persist = vi.fn().mockResolvedValue(undefined);

    const observed = await observeSalesPatternsInBackground(
      db,
      {
        accountId: 'acct-a',
        turns: [
          {
            id: sourceTurnId,
            sender_type: 'customer',
            content_text: 'too expensive',
          },
        ],
      },
      {
        loadMode: async () => 'shadow',
        retrieve,
        log,
        persist,
        observedAt: () => '2026-09-11T00:00:00.000Z',
      }
    );

    expect(observed).toBe(1);
    expect(retrieve).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        accountId: 'acct-a',
        patternType: 'PRICE_OBJECTION',
      })
    );
    expect(persist).toHaveBeenCalledWith(db, {
      accountId: 'acct-a',
      sourceTurnId,
      observedAt: '2026-09-11T00:00:00.000Z',
      injected: false,
      matches: [
        {
          patternId: 'pattern-1',
          patternType: 'PRICE_OBJECTION',
          matchScore: 55,
          matchReasons: ['patternType'],
        },
      ],
    });
    expect(JSON.stringify(persist.mock.calls)).not.toMatch(
      /too expensive|content_text|phone|email|transcript|prompt/i
    );
  });

  it.each(['off', 'on'] as const)(
    'does no background candidate work when mode is %s',
    async (mode) => {
      const retrieve = vi.fn();
      const persist = vi.fn();
      const observed = await observeSalesPatternsInBackground(
        db,
        {
          accountId: 'acct-a',
          turns: [
            {
              id: sourceTurnId,
              sender_type: 'customer',
              content_text: 'too expensive',
            },
          ],
        },
        { loadMode: async () => mode, retrieve, persist }
      );
      expect(observed).toBe(0);
      expect(retrieve).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
    }
  );

  it('reuses the source turn identity across worker retries', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const deps = {
      loadMode: async () => 'shadow' as const,
      retrieve: vi.fn().mockResolvedValue([]),
      log: vi.fn(),
      persist,
      observedAt: () => '2026-09-11T00:00:00.000Z',
    };
    const args = {
      accountId: 'acct-a',
      turns: [
        {
          id: sourceTurnId,
          sender_type: 'customer',
          content_text: 'too expensive',
        },
      ],
    };

    await observeSalesPatternsInBackground(db, args, deps);
    await observeSalesPatternsInBackground(db, args, deps);

    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0][1]).toEqual(persist.mock.calls[1][1]);
    expect(persist.mock.calls[0][1]).toMatchObject({
      accountId: 'acct-a',
      sourceTurnId,
      matches: [],
    });
  });
});
