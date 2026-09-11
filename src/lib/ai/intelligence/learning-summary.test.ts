import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  compileMerchantLearningSummary,
  loadMerchantLearningSummary,
  type LearningSummaryInput,
} from './learning-summary';

const db = {} as SupabaseClient;

function input(
  overrides: Partial<LearningSummaryInput> = {}
): LearningSummaryInput {
  return {
    controls: {
      available: true,
      mode: 'deterministic',
      paused: false,
    },
    volume: {
      available: true,
      conversation_count: 24,
      message_count: 100,
      customer_message_count: 50,
      first_message_at: '2026-09-04T00:00:00.000Z',
      last_message_at: '2026-09-11T00:00:00.000Z',
      analyzed_conversation_count: 20,
      analyzed_today_count: 3,
      unprocessed_conversation_count: 4,
      last_analyzed_at: '2026-09-11T04:00:00.000Z',
      recent_active_conversation_count: 24,
      estimated_analyze_jobs: 4,
      estimated_llm_calls_max: 4,
      analyze_queue_configured: true,
      window_days: 7,
    },
    events: {
      available: true,
      total: 9,
      by_type: [{ event_type: 'PRICE_OBJECTION', kind: 'signal', count: 9 }],
      first_created_at: '2026-09-10T00:00:00.000Z',
      last_created_at: '2026-09-11T00:00:00.000Z',
    },
    patterns: { available: true, rows: [] },
    recommendations: {
      available: false,
      shownCount: 0,
      selectedCount: 0,
      rejectedCount: 0,
      unresolvedCount: 0,
      lastObservedAt: null,
    },
    ...overrides,
  };
}

describe('compileMerchantLearningSummary', () => {
  it('returns an honest not-installed state without compiling insights', () => {
    const result = compileMerchantLearningSummary(
      input({
        controls: { available: false, mode: 'off', paused: false },
      })
    );
    expect(result).toMatchObject({
      available: false,
      status: 'not_installed',
      insights: [],
      metrics: { waiting: 4, insight_count: 0 },
    });
    expect(result.empty_state).toMatch(
      /not installed.*4 conversations.*will not change customer replies/i
    );
  });

  it('keeps off and paused states separate', () => {
    expect(
      compileMerchantLearningSummary(
        input({ controls: { available: true, mode: 'off', paused: false } })
      ).status
    ).toBe('off');
    expect(
      compileMerchantLearningSummary(
        input({
          controls: {
            available: true,
            mode: 'deterministic',
            paused: true,
          },
        })
      ).status
    ).toBe('paused');
  });

  it('does not turn below-threshold or trusted outcomes into insights', () => {
    const result = compileMerchantLearningSummary(
      input({
        events: {
          available: true,
          total: 8,
          by_type: [
            { event_type: 'PRICE_OBJECTION', kind: 'signal', count: 4 },
            { event_type: 'PAYMENT_COMPLETED', kind: 'outcome', count: 4 },
          ],
          first_created_at: null,
          last_created_at: null,
        },
      })
    );
    expect(result.insights).toEqual([]);
  });

  it('degrades safely when installed evidence relations are unavailable', () => {
    const result = compileMerchantLearningSummary(
      input({
        events: {
          available: false,
          total: 0,
          by_type: [],
          first_created_at: null,
          last_created_at: null,
        },
        patterns: { available: false, rows: [] },
      })
    );
    expect(result).toMatchObject({
      available: false,
      status: 'active_deterministic',
      insights: [],
      empty_state:
        'Learning data is not available yet. Customer replies remain unchanged.',
    });
  });

  it('compiles allowlisted event copy with measurable evidence', () => {
    const result = compileMerchantLearningSummary(input());
    expect(result.metrics).toMatchObject({
      analyzed_today: 3,
      new_sales_events: 9,
      customer_trend_count: 1,
      strong_pattern_count: 0,
    });
    expect(result.insights).toEqual([
      expect.objectContaining({
        id: 'event:PRICE_OBJECTION',
        strength: 'observed',
        sourceLayer: 'sales_event',
        summary: expect.stringMatching(/appeared 9 times.*7 days/i),
        evidence: {
          windowDays: 7,
          sampleSize: 9,
          signalCount: 9,
          outcomeCount: 0,
          successCount: 0,
          failureCount: 0,
          unresolvedCount: 0,
        },
      }),
    ]);
  });

  it('keeps event insights when the pattern layer is unavailable', () => {
    const result = compileMerchantLearningSummary(
      input({
        patterns: { available: false, rows: [] },
      })
    );
    expect(result.available).toBe(true);
    expect(result.insights).toHaveLength(1);
    expect(result.insights[0]?.sourceLayer).toBe('sales_event');
  });

  it('labels strong patterns only when sample and outcome thresholds pass', () => {
    const result = compileMerchantLearningSummary(
      input({
        events: {
          available: true,
          total: 0,
          by_type: [],
          first_created_at: null,
          last_created_at: null,
        },
        patterns: {
          available: true,
          rows: [
            {
              id: 'p-strong',
              pattern_type: 'PRODUCT_COMPARISON',
              status: 'active',
              sample_count: 20,
              success_count: 5,
              failure_count: 2,
              eligible_outcome_count: 7,
              unresolved_count: 13,
              first_observed_at: '2026-08-01T00:00:00.000Z',
              last_observed_at: '2026-09-11T02:00:00.000Z',
            },
            {
              id: 'p-emerging',
              pattern_type: 'PRICE_OBJECTION',
              status: 'candidate',
              sample_count: 6,
              success_count: 0,
              failure_count: 0,
              eligible_outcome_count: 0,
              unresolved_count: 6,
              first_observed_at: '2026-09-10T00:00:00.000Z',
              last_observed_at: '2026-09-11T01:00:00.000Z',
            },
          ],
        },
      })
    );
    expect(result.insights.map((insight) => insight.strength)).toEqual([
      'strong',
      'emerging',
    ]);
    expect(result.metrics).toMatchObject({
      emerging_pattern_count: 1,
      strong_pattern_count: 1,
    });
    expect(result.insights[0]?.evidence).toMatchObject({
      windowDays: 42,
      sampleSize: 20,
      outcomeCount: 7,
      successCount: 5,
      failureCount: 2,
      unresolvedCount: 13,
    });
    expect(result.insights[0]?.summary).not.toMatch(/caused|guaranteed|last 7 days/i);
  });

  it('describes recommendation evidence as an association, not causality', () => {
    const result = compileMerchantLearningSummary(
      input({
        events: {
          available: true,
          total: 0,
          by_type: [],
          first_created_at: null,
          last_created_at: null,
        },
        recommendations: {
          available: true,
          shownCount: 18,
          selectedCount: 5,
          rejectedCount: 2,
          unresolvedCount: 11,
          lastObservedAt: '2026-09-11T03:00:00.000Z',
        },
      })
    );
    expect(result.insights[0]).toMatchObject({
      sourceLayer: 'recommendation',
      evidence: {
        sampleSize: 18,
        successCount: 5,
        failureCount: 2,
        unresolvedCount: 11,
      },
    });
    expect(result.insights[0]?.summary).toMatch(/association, not proof/i);
  });

  it('caps and orders insights by strength then sample size', () => {
    const patterns = Array.from({ length: 10 }, (_, index) => ({
      id: `p-${index}`,
      pattern_type: index === 0 ? 'PRICE_OBJECTION' : 'PRODUCT_INQUIRY',
      status: index === 0 ? 'active' : 'candidate',
      sample_count: index === 0 ? 20 : 5 + index,
      success_count: index === 0 ? 5 : 0,
      failure_count: 0,
      eligible_outcome_count: index === 0 ? 5 : 0,
      unresolved_count: 5,
      first_observed_at: null,
      last_observed_at: null,
    }));
    const result = compileMerchantLearningSummary(
      input({ patterns: { available: true, rows: patterns } })
    );
    expect(result.insights).toHaveLength(8);
    expect(result.insights[0]?.strength).toBe('strong');
  });

  it('does not expose customer PII fields or raw messages', () => {
    const payload = JSON.stringify(compileMerchantLearningSummary(input()));
    expect(payload).not.toMatch(
      /phone_number|email|address|transcript|raw_message|customer_name/i
    );
  });
});

describe('loadMerchantLearningSummary', () => {
  it('scopes every active loader by the required account and compiles once', async () => {
    const loaders = {
      loadVolume: vi.fn(async () => input().volume),
      loadEvents: vi.fn(async () => input().events),
      loadControls: vi.fn(async () => input().controls),
      loadPatterns: vi.fn(async () => input().patterns),
      loadRecommendations: vi.fn(async () => input().recommendations),
    };
    const result = await loadMerchantLearningSummary(db, ' acct-a ', loaders);
    expect(result.status).toBe('active_deterministic');
    for (const loader of Object.values(loaders)) {
      expect(loader).toHaveBeenCalledWith(db, 'acct-a');
    }
  });

  it('does not query intelligence evidence while controls are off', async () => {
    const loaders = {
      loadVolume: vi.fn(async () => input().volume),
      loadEvents: vi.fn(async () => input().events),
      loadControls: vi.fn(async () => ({
        available: true,
        mode: 'off' as const,
        paused: false,
      })),
      loadPatterns: vi.fn(async () => input().patterns),
      loadRecommendations: vi.fn(async () => input().recommendations),
    };
    const result = await loadMerchantLearningSummary(db, 'acct-a', loaders);
    expect(result.status).toBe('off');
    expect(loaders.loadEvents).not.toHaveBeenCalled();
    expect(loaders.loadPatterns).not.toHaveBeenCalled();
    expect(loaders.loadRecommendations).not.toHaveBeenCalled();
  });
});
