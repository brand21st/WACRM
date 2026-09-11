import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { classifySalesTurn } from '@/lib/shopify/sales-turn';
import { emptyShoppingContext } from '@/lib/catalog/intelligence/shopping-context';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { MissingAccountIdError } from './contracts';
import {
  loadSalesPatternRetrievalMode,
  retrieveSalesPatterns,
  persistSalesPatternShadowDiagnostics,
  resolveSalesPatternGuidance,
  salesPatternDiagnosticPayload,
  stableSourceTurnDiagnosticId,
  type SalesPatternRow,
} from './retrieve-sales-patterns';
import {
  CANDIDATE_QUERY_LIMIT,
  MAX_RETURNED_PATTERNS,
} from './sales-pattern-score';
import { formatSalesPatternGuidance } from './sales-pattern-prompt';

const unusedDb = {} as SupabaseClient;

function patternRow(
  partial: Partial<SalesPatternRow> & Pick<SalesPatternRow, 'id' | 'account_id'>
): SalesPatternRow {
  return {
    pattern_type: 'PRICE_OBJECTION',
    trigger_event_type: 'PRICE_OBJECTION',
    context: { category: 'saree' },
    recommended_behavior: 'OFFER_RELEVANT_ALTERNATIVE',
    confidence: 0.7,
    sample_count: 12,
    eligible_outcome_count: 10,
    evidence: { successRate: 0.6 },
    last_observed_at: '2026-09-01T00:00:00.000Z',
    status: 'active',
    ...partial,
  };
}

describe('retrieveSalesPatterns isolation', () => {
  it('throws before any loader when accountId is missing', async () => {
    const loadActivePatterns = vi.fn();
    await expect(
      retrieveSalesPatterns(
        unusedDb,
        { accountId: '', patternType: 'PRICE_OBJECTION' },
        { loadActivePatterns }
      )
    ).rejects.toBeInstanceOf(MissingAccountIdError);
    expect(loadActivePatterns).not.toHaveBeenCalled();
  });

  it('does not return another tenant’s patterns', async () => {
    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      {
        loadActivePatterns: async () => [
          patternRow({ id: 'b-1', account_id: 'acct-b' }),
        ],
      }
    );
    expect(matches).toEqual([]);
  });

  it('filters a poisoned mixed loader', async () => {
    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      {
        loadActivePatterns: async () => [
          patternRow({ id: 'a-1', account_id: 'acct-a' }),
          patternRow({ id: 'b-1', account_id: 'acct-b' }),
        ],
      }
    );
    expect(matches.map((row) => row.patternId)).toEqual(['a-1']);
  });
});

describe('retrieveSalesPatterns eligibility', () => {
  it('scores active rows and ignores other statuses from a poisoned loader', async () => {
    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      {
        loadActivePatterns: async () => [
          patternRow({ id: 'active', account_id: 'acct-a', status: 'active' }),
          patternRow({
            id: 'candidate',
            account_id: 'acct-a',
            status: 'candidate',
          }),
          patternRow({ id: 'stale', account_id: 'acct-a', status: 'stale' }),
          patternRow({
            id: 'archived',
            account_id: 'acct-a',
            status: 'archived',
          }),
        ],
      }
    );
    expect(matches.map((row) => row.patternId)).toEqual(['active']);
  });

  it('ignores active rows that Phase 6 marked ineligible', async () => {
    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      {
        loadActivePatterns: async () => [
          patternRow({
            id: 'ineligible',
            account_id: 'acct-a',
            retrieval_eligible: false,
          }),
          patternRow({
            id: 'eligible',
            account_id: 'acct-a',
            retrieval_eligible: true,
          }),
        ],
      }
    );
    expect(matches.map((row) => row.patternId)).toEqual(['eligible']);
  });

  it('returns at most 3 patterns and skips null pattern types without querying', async () => {
    const loadActivePatterns = vi
      .fn()
      .mockResolvedValue(
        Array.from({ length: 8 }, (_, i) =>
          patternRow({ id: `p-${i}`, account_id: 'acct-a' })
        )
      );
    expect(
      await retrieveSalesPatterns(
        unusedDb,
        { accountId: 'acct-a', patternType: null },
        { loadActivePatterns }
      )
    ).toEqual([]);
    expect(loadActivePatterns).not.toHaveBeenCalled();

    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      { loadActivePatterns }
    );
    expect(matches).toHaveLength(MAX_RETURNED_PATTERNS);
  });

  it('returns [] when the loader fails', async () => {
    const matches = await retrieveSalesPatterns(
      unusedDb,
      { accountId: 'acct-a', patternType: 'PRICE_OBJECTION' },
      {
        loadActivePatterns: async () => {
          throw new Error('relation sales_patterns does not exist');
        },
      }
    );
    expect(matches).toEqual([]);
  });

  it('maps a compact DTO without PII or transcripts', async () => {
    const [match] = await retrieveSalesPatterns(
      unusedDb,
      {
        accountId: 'acct-a',
        patternType: 'PRICE_OBJECTION',
        shopping: {
          ...emptyShoppingContext(),
          categoryHint: 'saree',
        },
      },
      {
        loadActivePatterns: async () => [
          patternRow({
            id: 'p-1',
            account_id: 'acct-a',
            context: { category: 'saree' },
          }),
        ],
      }
    );
    expect(match).toMatchObject({
      patternId: 'p-1',
      patternType: 'PRICE_OBJECTION',
      recommendedBehavior: 'OFFER_RELEVANT_ALTERNATIVE',
      successRate: 0.6,
    });
    expect(JSON.stringify(match)).not.toMatch(
      /phone|email|address|transcript/i
    );
    expect(match).not.toHaveProperty('account_id');
  });
});

describe('retrieveSalesPatterns query', () => {
  it('scopes the default loader to account_id, active status, and LIMIT 40', async () => {
    const calls: Array<[string, unknown]> = [];
    let limited = 0;
    const db = {
      from: (table: string) => {
        expect(table).toBe('sales_patterns');
        return {
          select: () => ({
            eq: (col: string, val: unknown) => {
              calls.push([col, val]);
              return {
                eq: (col2: string, val2: unknown) => {
                  calls.push([col2, val2]);
                  return {
                    eq: (col3: string, val3: unknown) => {
                      calls.push([col3, val3]);
                      return {
                        order: () => ({
                          limit: (n: number) => {
                            limited = n;
                            return Promise.resolve({ data: [], error: null });
                          },
                        }),
                      };
                    },
                  };
                },
              };
            },
          }),
        };
      },
    } as unknown as SupabaseClient;

    await retrieveSalesPatterns(db, {
      accountId: 'acct-a',
      patternType: 'PRICE_OBJECTION',
    });
    expect(calls).toEqual([
      ['account_id', 'acct-a'],
      ['status', 'active'],
      ['retrieval_eligible', true],
    ]);
    expect(limited).toBe(CANDIDATE_QUERY_LIMIT);
  });
});

describe('loadSalesPatternRetrievalMode', () => {
  it('defaults to off when missing, unknown, or errored', async () => {
    const missing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await loadSalesPatternRetrievalMode(missing, 'acct-a')).toBe('off');

    const unknown = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { sales_pattern_retrieval: 'maybe' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await loadSalesPatternRetrievalMode(unknown, 'acct-a')).toBe('off');

    const broken = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'column does not exist' },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await loadSalesPatternRetrievalMode(broken, 'acct-a')).toBe('off');
  });

  it('returns shadow and on', async () => {
    const db = (mode: string) =>
      ({
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { sales_pattern_retrieval: mode },
                error: null,
              }),
            }),
          }),
        }),
      }) as unknown as SupabaseClient;
    expect(await loadSalesPatternRetrievalMode(db('shadow'), 'acct-a')).toBe(
      'shadow'
    );
    expect(await loadSalesPatternRetrievalMode(db('on'), 'acct-a')).toBe('on');
  });
});

describe('resolveSalesPatternGuidance', () => {
  it('does not query when the flag is off', async () => {
    const retrieve = vi.fn();
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        sourceTurnId: '00000000-0000-5000-8000-000000000001',
      },
      {
        loadMode: async () => 'off',
        retrieve,
      }
    );
    expect(result).toEqual({
      salesGuidance: null,
      queried: false,
      matches: [],
      mode: 'off',
    });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('fails closed when a persisted live flag lacks runtime approval', async () => {
    const retrieve = vi.fn();
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => false,
        retrieve,
      }
    );
    expect(result.salesGuidance).toBeNull();
    expect(result.queried).toBe(false);
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('does not query greeting or stay turns even when on', async () => {
    const retrieve = vi.fn();
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('hi'),
        queryText: 'hi',
      },
      { loadMode: async () => 'on', allowLive: () => true, retrieve }
    );
    expect(result.queried).toBe(false);
    expect(result.salesGuidance).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('returns no guidance or side effects in customer-facing shadow mode', async () => {
    const retrieve = vi.fn();
    const log = vi.fn();
    const persist = vi.fn();
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        sourceTurnId: '00000000-0000-5000-8000-000000000001',
      },
      {
        loadMode: async () => 'shadow',
        retrieve,
        log,
        persist,
      }
    );
    expect(result).toEqual({
      salesGuidance: null,
      queried: false,
      matches: [],
      mode: 'shadow',
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not persist diagnostics when retrieval is on', async () => {
    const persist = vi.fn();
    await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        retrieve: async () => [],
        log: () => undefined,
        persist,
      }
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not invoke shadow persistence from the customer path', async () => {
    const persist = vi.fn(async () => {
      throw new Error('persist down');
    });
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
      },
      {
        loadMode: async () => 'shadow',
        retrieve: async () => [],
        log: () => undefined,
        persist,
      }
    );
    expect(result.salesGuidance).toBeNull();
    expect(result.queried).toBe(false);
    expect(persist).not.toHaveBeenCalled();
  });

  it('injects at most 3 patterns when on', async () => {
    const matches = [1, 2, 3].map((n) => ({
      patternId: `p-${n}`,
      patternType: 'PRICE_OBJECTION' as const,
      triggerEventType: 'PRICE_OBJECTION',
      context: {},
      recommendedBehavior: 'OFFER_RELEVANT_ALTERNATIVE' as const,
      confidence: 0.5,
      sampleCount: 8,
      eligibleOutcomeCount: 6,
      successRate: null,
      matchScore: 40,
      matchReasons: ['patternType'],
    }));
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        retrieve: async () => matches,
        log: () => undefined,
      }
    );
    expect(result.queried).toBe(true);
    expect(result.salesGuidance).toContain('Business Sales Guidance');
    expect(result.salesGuidance).toContain('OFFER_RELEVANT_ALTERNATIVE');
    const patternLines = result
      .salesGuidance!.split('\n')
      .filter((line) => /^\d+\./.test(line));
    expect(patternLines).toHaveLength(3);
    expect(patternLines.join('\n')).not.toMatch(
      /our past customers|conversion rate|our model learned/i
    );
  });

  it('continues with empty guidance when retrieval throws', async () => {
    const result = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        retrieve: async () => {
          throw new Error('db down');
        },
      }
    );
    expect(result.salesGuidance).toBeNull();
    expect(result.matches).toEqual([]);
  });
});

describe('salesPatternDiagnosticPayload privacy', () => {
  it('only exposes safe metadata keys', () => {
    const payload = salesPatternDiagnosticPayload({
      accountId: 'acct-a',
      injected: false,
      matches: [
        {
          patternId: 'p-1',
          patternType: 'PURCHASE_INTENT',
          triggerEventType: 'PURCHASE_INTENT',
          context: {},
          recommendedBehavior: 'CONFIRM_AND_CHECKOUT',
          confidence: 0.4,
          sampleCount: 8,
          eligibleOutcomeCount: 5,
          successRate: null,
          matchScore: 40,
          matchReasons: ['patternType'],
        },
      ],
    });
    expect(Object.keys(payload).sort()).toEqual([
      'accountId',
      'injected',
      'matches',
      'observedAt',
      'sourceTurnId',
    ]);
    expect(Object.keys(payload.matches[0]).sort()).toEqual([
      'matchReasons',
      'matchScore',
      'patternId',
      'patternType',
    ]);
  });
});

describe('persistSalesPatternShadowDiagnostics', () => {
  it('writes injected=false rows scoped to the account and no transcript fields', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    await persistSalesPatternShadowDiagnostics(
      { from: () => ({ upsert }) } as never,
      {
        accountId: 'acct-a',
        sourceTurnId: '00000000-0000-5000-8000-000000000001',
        observedAt: '2026-09-11T00:00:00.000Z',
        injected: false,
        matches: [
          {
            patternId: 'p-1',
            patternType: 'PRICE_OBJECTION',
            matchScore: 55,
            matchReasons: ['patternType'],
          },
        ],
      }
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    const rows = upsert.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      account_id: 'acct-a',
      source_turn_id: '00000000-0000-5000-8000-000000000001',
      pattern_id: 'p-1',
      pattern_type: 'PRICE_OBJECTION',
      match_score: 55,
      injected: false,
      created_at: '2026-09-11T00:00:00.000Z',
    });
    expect(JSON.stringify(rows)).not.toMatch(
      /phone|email|transcript|content_text|prompt/i
    );
    expect(upsert.mock.calls[0][1]).toEqual({
      onConflict: 'account_id,source_turn_id,pattern_id',
      ignoreDuplicates: true,
    });
  });
});

describe('shadow diagnostic identity and equivalence', () => {
  it('derives a stable opaque source-turn UUID', () => {
    const source = stableSourceTurnDiagnosticId(
      'acct-a',
      'conversation-a',
      'wamid.retry-safe'
    );
    expect(source).toBe(
      stableSourceTurnDiagnosticId(
        'acct-a',
        'conversation-a',
        'wamid.retry-safe'
      )
    );
    expect(source).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(
      stableSourceTurnDiagnosticId('acct-a', 'conversation-a', undefined)
    ).toBeNull();
  });

  it('forces injected=false even for a malformed persistence call', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    await persistSalesPatternShadowDiagnostics(
      { from: () => ({ upsert }) } as never,
      {
        accountId: 'acct-a',
        sourceTurnId: '00000000-0000-5000-8000-000000000001',
        observedAt: '2026-09-11T00:00:00.000Z',
        injected: true,
        matches: [],
      }
    );
    expect(upsert.mock.calls[0][0][0]).toMatchObject({
      turn_id: '00000000-0000-5000-8000-000000000001',
      source_turn_id: '00000000-0000-5000-8000-000000000001',
      injected: false,
    });
  });

  it('keeps the exact prompt unchanged in shadow mode', async () => {
    const baseline = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      salesGuidance: null,
    });
    const retrieve = vi.fn();
    const resolved = await resolveSalesPatternGuidance(
      unusedDb,
      {
        accountId: 'acct-a',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        sourceTurnId: '00000000-0000-5000-8000-000000000001',
      },
      {
        loadMode: async () => 'shadow',
        retrieve,
        log: () => undefined,
        persist: async () => undefined,
      }
    );
    const shadow = buildSystemPrompt({
      userPrompt: null,
      mode: 'auto_reply',
      salesGuidance: resolved.salesGuidance,
    });
    expect(resolved.salesGuidance).toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
    expect(shadow).toBe(baseline);
  });
});

describe('formatSalesPatternGuidance', () => {
  it('states hints must not override facts, policy, or customer request', () => {
    const block = formatSalesPatternGuidance([
      {
        recommendedBehavior: 'EXPLAIN_VALUE_BEFORE_DISCOUNT',
        patternType: 'DISCOUNT_REQUEST',
        context: {},
        confidence: 0.5,
        sampleCount: 9,
        eligibleOutcomeCount: 6,
      },
    ]);
    expect(block).toMatch(/not a business policy/);
    expect(block).toMatch(/not a product fact/);
    expect(block).toMatch(/not permission to discount/);
    expect(block).toMatch(/must not override the current customer request/);
    expect(block).toMatch(/must not override current catalog facts/);
    expect(block).toMatch(/must not override business knowledge/);
    expect(block).toMatch(/Do not say/);
    expect(block).toMatch(/Do not mention past customers/);
  });
});
