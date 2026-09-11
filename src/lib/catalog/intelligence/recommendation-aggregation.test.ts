import { describe, expect, it, vi } from 'vitest';
import {
  aggregateRecommendationEvidence,
  drainRecommendationIntelligence,
  reconcileRecommendationIntelligence,
  refreshRecommendationIntelligence,
} from './recommendation-aggregation';
import { createCatalogMemoryDb } from '../search/memory-db';
import type {
  AttributedRecommendationAction,
  RecommendationEvidenceRow,
} from './recommendation-evidence';

function evidence(
  event: RecommendationEvidenceRow['event'],
  overrides: Partial<RecommendationEvidenceRow> = {}
): RecommendationEvidenceRow {
  return {
    account_id: 'acct-a',
    recommendation_set_id: 'set-a',
    conversation_id: 'conv-a',
    mode: 'recommend',
    product_id: 'product-a',
    event,
    algorithm_version: 'catalog-baseline-v1',
    ranking_variant: 'baseline',
    is_shadow: false,
    is_injected: true,
    baseline_rank: 2,
    created_at: '2026-09-11T04:00:00.000Z',
    ...overrides,
  };
}

describe('aggregateRecommendationEvidence', () => {
  it('builds account-leading smoothed non-causal rates', () => {
    const attributed: AttributedRecommendationAction[] = [
      {
        accountId: 'acct-a',
        recommendationSetId: 'set-a',
        productId: 'product-a',
        mode: 'recommend',
        algorithmVersion: 'catalog-baseline-v1',
        action: 'selected',
        sourceOutcomeId: 'outcome-a',
        confidence: 'mapped',
        createdAt: '2026-09-11T04:05:00.000Z',
      },
    ];
    const [stat] = aggregateRecommendationEvidence(
      'acct-a',
      [
        evidence('generated'),
        evidence('shown'),
        evidence('rejected'),
        evidence('shown', { account_id: 'acct-b' }),
      ],
      attributed
    );
    expect(stat).toMatchObject({
      accountId: 'acct-a',
      productId: 'product-a',
      generatedCount: 1,
      shownCount: 1,
      selectedCount: 1,
      rejectedCount: 1,
      attributedOutcomeCount: 1,
      selectionRate: 1,
      rejectionRate: 1,
      smoothedSelectionRate: 2 / 3,
      smoothedRejectionRate: 2 / 3,
      baselineRankAvg: 2,
    });
  });

  it('keeps shadow evidence separate by algorithm version', () => {
    const stats = aggregateRecommendationEvidence('acct-a', [
      evidence('generated'),
      evidence('generated', {
        algorithm_version: 'catalog-learned-v1',
        ranking_variant: 'shadow',
        is_shadow: true,
        is_injected: false,
        baseline_rank: 2,
        shadow_rank: 1,
      }),
    ]);
    expect(stats).toHaveLength(2);
    expect(
      stats.find((row) => row.algorithmVersion === 'catalog-learned-v1')
    ).toMatchObject({
      shadowRankAvg: 1,
      baselineRankAvg: 2,
    });
  });

  it('preserves last good stats when atomic replacement fails', async () => {
    const db = createCatalogMemoryDb({
      catalog_recommendation_events: [
        {
          id: 'event-a',
          ...evidence('shown'),
        },
      ],
      catalog_product_events: [],
      catalog_recommendation_stats: [
        {
          account_id: 'acct-a',
          product_id: 'last-good',
          mode: 'recommend',
        },
      ],
      ai_configs: [
        { account_id: 'acct-a', recommendation_intelligence: 'off' },
      ],
    });
    await expect(
      refreshRecommendationIntelligence(db, 'acct-a', {
        replaceStats: async () => {
          throw new Error('replacement failed');
        },
      })
    ).rejects.toThrow('replacement failed');
    const { data } = await db
      .from('catalog_recommendation_stats')
      .select()
      .eq('account_id', 'acct-a');
    expect(data).toHaveLength(1);
    expect(data?.[0]?.product_id).toBe('last-good');
  });

  it('leaves dirty evidence pending while recommendation intelligence is off', async () => {
    const db = createCatalogMemoryDb({
      ai_configs: [
        { account_id: 'acct-a', recommendation_intelligence: 'off' },
      ],
    });
    const rpc = vi.fn();
    (db as unknown as { rpc: typeof rpc }).rpc = rpc;
    await expect(
      reconcileRecommendationIntelligence(db, 'acct-a')
    ).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('claims and completes the exact pending watermark', async () => {
    const db = createCatalogMemoryDb({
      catalog_recommendation_events: [],
      catalog_product_events: [],
      ai_configs: [
        { account_id: 'acct-a', recommendation_intelligence: 'shadow' },
      ],
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_recommendation_intelligence') {
        return {
          data: [
            {
              pending_recommendation_event_created_at: '2026-09-11T04:00:00Z',
              pending_recommendation_event_id: 'event-a',
              pending_product_event_created_at: null,
              pending_product_event_id: null,
            },
          ],
          error: null,
        };
      }
      return {
        data: name === 'replace_catalog_recommendation_stats' ? 0 : true,
        error: null,
      };
    });
    (db as unknown as { rpc: typeof rpc }).rpc = rpc;
    await reconcileRecommendationIntelligence(db, 'acct-a');
    expect(rpc).toHaveBeenCalledWith('complete_recommendation_intelligence', {
      p_account_id: 'acct-a',
      p_recommendation_created_at: '2026-09-11T04:00:00Z',
      p_recommendation_id: 'event-a',
      p_product_created_at: null,
      p_product_id: null,
    });
  });

  it('marks a claimed reconciliation failed without replacing good stats', async () => {
    const db = createCatalogMemoryDb({
      catalog_recommendation_events: [],
      catalog_product_events: [],
      ai_configs: [
        { account_id: 'acct-a', recommendation_intelligence: 'shadow' },
      ],
    });
    const rpc = vi.fn(async (name: string) => {
      if (name === 'claim_recommendation_intelligence') {
        return {
          data: [
            {
              pending_recommendation_event_created_at: null,
              pending_recommendation_event_id: null,
              pending_product_event_created_at: null,
              pending_product_event_id: null,
            },
          ],
          error: null,
        };
      }
      if (name === 'replace_catalog_recommendation_stats') {
        return { data: null, error: { message: 'atomic replacement failed' } };
      }
      return { data: true, error: null };
    });
    (db as unknown as { rpc: typeof rpc }).rpc = rpc;
    await expect(
      reconcileRecommendationIntelligence(db, 'acct-a')
    ).rejects.toMatchObject({ message: 'atomic replacement failed' });
    expect(rpc).toHaveBeenCalledWith('fail_recommendation_intelligence', {
      p_account_id: 'acct-a',
      p_error: 'atomic replacement failed',
    });
  });

  it('drains a bounded due list through the existing enqueue callback', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ account_id: 'acct-a' }, { account_id: 'acct-b' }],
      error: null,
    }));
    const enqueue = vi.fn(async () => true);
    const db = { rpc } as unknown as Parameters<
      typeof drainRecommendationIntelligence
    >[0];
    const result = await drainRecommendationIntelligence(db, {
      limit: 500,
      enqueue,
    });
    expect(rpc).toHaveBeenCalledWith('list_due_recommendation_intelligence', {
      p_limit: 100,
    });
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      accounts: ['acct-a', 'acct-b'],
      queued: 2,
      ran: 0,
    });
  });
});
