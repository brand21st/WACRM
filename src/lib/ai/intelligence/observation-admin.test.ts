import { describe, expect, it, vi } from 'vitest';
import { MissingAccountIdError } from './contracts';
import {
  assertSafeObservationPayload,
  loadObservationEvents,
  loadObservationShadow,
  loadRecommendationShadow,
  recommendationShadowRowsFromLedger,
  rankAgreement,
  shadowRetentionSince,
  summarizeRecommendationShadow,
} from './observation-admin';

function chain(result: { data: unknown; error: unknown }) {
  const query = {
    select: () => query,
    eq: () => query,
    gte: () => query,
    order: () => query,
    limit: async () => result,
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      resolve(result),
  };
  return query;
}

describe('observation-admin isolation', () => {
  it('throws before querying when accountId is missing', async () => {
    const from = vi.fn();
    await expect(
      loadObservationEvents({ from } as never, '')
    ).rejects.toBeInstanceOf(MissingAccountIdError);
    expect(from).not.toHaveBeenCalled();
  });

  it('aggregates sales events through the account-scoped RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          event_type: 'PRICE_OBJECTION',
          kind: 'signal',
          event_count: 9,
          first_created_at: '2026-09-04T00:00:00.000Z',
          last_created_at: '2026-09-11T00:00:00.000Z',
        },
      ],
      error: null,
    });
    const report = await loadObservationEvents({ rpc } as never, 'acct-a', {
      since: '2026-09-04T00:00:00.000Z',
    });
    expect(rpc).toHaveBeenCalledWith('count_sales_events_by_type', {
      p_account_id: 'acct-a',
      p_since: '2026-09-04T00:00:00.000Z',
    });
    expect(report.total).toBe(9);
    expect(report.truncated).toBeUndefined();
    expect(report.by_type[0]?.event_type).toBe('PRICE_OBJECTION');
    expect(JSON.stringify(report)).not.toMatch(
      /phone|email|transcript|content_text/i
    );
  });

  it('marks the 5k fallback as truncated when the RPC is missing', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message: 'function count_sales_events_by_type(uuid, timestamp with time zone) does not exist',
      },
    });
    const query = {
      select: () => query,
      eq: () => query,
      gte: () => query,
      order: () => query,
      limit: async () => ({
        data: Array.from({ length: 5000 }, () => ({
          event_type: 'PRICE_OBJECTION',
          kind: 'signal',
          created_at: '2026-09-11T00:00:00.000Z',
        })),
        error: null,
      }),
    };
    const report = await loadObservationEvents(
      { rpc, from: () => query } as never,
      'acct-a',
      { since: '2026-09-04T00:00:00.000Z' }
    );
    expect(report.total).toBe(5000);
    expect(report.truncated).toBe(true);
  });

  it('returns unavailable shadow data when the table is missing', async () => {
    const report = await loadObservationShadow(
      {
        from: () =>
          chain({
            data: null,
            error: {
              code: '42P01',
              message:
                'relation sales_pattern_shadow_diagnostics does not exist',
            },
          }),
      } as never,
      'acct-a'
    );
    expect(report.available).toBe(false);
    expect(report.eligible_turns).toBe(0);
  });
});

describe('assertSafeObservationPayload', () => {
  it('rejects customer identifiers', () => {
    expect(() => assertSafeObservationPayload({ phone: '+1555' })).toThrow(
      /customer identifiers/
    );
  });
});

describe('shadow observation metrics', () => {
  it('selects a bounded 30-day retention window', () => {
    expect(shadowRetentionSince(new Date('2026-09-11T00:00:00.000Z'))).toBe(
      '2026-08-12T00:00:00.000Z'
    );
    expect(shadowRetentionSince(new Date('2026-09-11T00:00:00.000Z'), 90)).toBe(
      '2026-08-12T00:00:00.000Z'
    );
  });

  it('summarizes recommendation rank agreement without customer data', () => {
    const report = summarizeRecommendationShadow([
      {
        source_turn_id: 'turn-1',
        baseline_product_ids: ['p-1', 'p-2'],
        shadow_product_ids: ['p-2', 'p-1'],
        baseline_scores: [0.9, 0.8],
        shadow_scores: [0.85, 0.75],
        baseline_evidence_count: 2,
        shadow_evidence_count: 1,
        shadow_reasons: ['same_category', 'evidence_supported'],
        injected: false,
      },
      {
        source_turn_id: 'turn-2',
        baseline_product_ids: ['p-3'],
        shadow_product_ids: ['p-4'],
        baseline_scores: [0.7],
        shadow_scores: [0.4],
        baseline_evidence_count: 1,
        shadow_evidence_count: 0,
        shadow_reasons: ['weak_match'],
        injected: false,
      },
    ]);
    expect(report).toMatchObject({
      available: true,
      eligible_turns: 2,
      baseline_result_count: 3,
      shadow_result_count: 3,
      potentially_irrelevant: 1,
      evidence_coverage: { baseline: 1.5, shadow: 0.5, delta: -1 },
    });
    expect(report.rank_agreement).toBeCloseTo(0.25);
    expect(JSON.stringify(report)).not.toMatch(
      /phone|email|address|transcript|content_text/i
    );
  });

  it('gives full agreement to identical ranks and none to disjoint ranks', () => {
    expect(rankAgreement(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(rankAgreement(['a'], ['b'])).toBe(0);
  });

  it('builds one shadow comparison from the existing recommendation ledger', () => {
    const rows = recommendationShadowRowsFromLedger([
      {
        recommendation_set_id: 'set-1',
        source_turn_id: 'turn-1',
        product_id: 'p-1',
        score: 0.8,
        reasons: ['baseline'],
        ranking_variant: 'baseline',
        rank: 1,
        baseline_rank: 1,
        shadow_rank: null,
        is_injected: true,
      },
      {
        recommendation_set_id: 'set-1',
        source_turn_id: 'turn-1',
        product_id: 'p-1',
        score: 0.9,
        reasons: ['observed_selection'],
        ranking_variant: 'shadow',
        rank: 1,
        baseline_rank: 1,
        shadow_rank: 1,
        is_injected: false,
      },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({
        source_turn_id: 'turn-1',
        baseline_product_ids: ['p-1'],
        shadow_product_ids: ['p-1'],
        injected: false,
      }),
    ]);
  });

  it('scopes recommendation diagnostics to tenant before retention filters', async () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        calls.push([column, value]);
        return query;
      },
      gte: (column: string, value: unknown) => {
        calls.push([column, value]);
        return query;
      },
      order: () => query,
      limit: async () => ({ data: [], error: null }),
    };
    const report = await loadRecommendationShadow(
      { from: () => query } as never,
      'acct-a',
      '2026-08-12T00:00:00.000Z'
    );
    expect(calls).toEqual([
      ['account_id', 'acct-a'],
      ['event', 'generated'],
      ['created_at', '2026-08-12T00:00:00.000Z'],
    ]);
    expect(report.available).toBe(true);
  });
});
