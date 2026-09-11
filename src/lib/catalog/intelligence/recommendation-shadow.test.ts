import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '../search/memory-db'
import { intelSeed } from './facts.test'
import type { RecommendationEvidenceRow } from './recommendation-evidence'
import { materializeRecommendationShadows } from './recommendation-shadow'

function baseline(productId: string, rank: number): RecommendationEvidenceRow {
  return {
    id: `event-${productId}`,
    account_id: 'acct-a',
    recommendation_set_id: 'set-a',
    contact_id: 'contact-a',
    conversation_id: 'conversation-a',
    source_message_id: 'message-a',
    source_turn_id: 'turn-a',
    mode: 'similar',
    seed_product_id: 'p-red',
    product_id: productId,
    score: 10 - rank,
    reasons: [],
    event: 'generated',
    rank,
    algorithm_version: 'catalog-baseline-v1',
    ranking_variant: 'baseline',
    is_shadow: false,
    is_injected: true,
    baseline_rank: rank,
    created_at: '2026-09-11T04:00:00.000Z',
  }
}

describe('materializeRecommendationShadows', () => {
  it('runs off-path and cannot admit foreign or unavailable candidates', async () => {
    const evidence = [
      baseline('p-navy', 1),
      baseline('p-gold', 2),
      baseline('p-oos', 3),
      baseline('p-b', 4),
    ]
    const db = createCatalogMemoryDb({
      ...intelSeed(),
      ai_configs: [
        {
          account_id: 'acct-a',
          recommendation_intelligence: 'shadow',
        },
      ],
      catalog_recommendation_stats: [
        {
          account_id: 'acct-a',
          product_id: 'p-gold',
          mode: 'similar',
          algorithm_version: 'catalog-baseline-v1',
          smoothed_selection_rate: 0.95,
          smoothed_rejection_rate: 0.05,
          shown_count: 20,
        },
      ],
      catalog_recommendation_events: evidence as unknown as Record<
        string,
        unknown
      >[],
    })
    expect(await materializeRecommendationShadows(db, 'acct-a', evidence)).toBe(2)
    const { data } = await db
      .from('catalog_recommendation_events')
      .select()
      .eq('ranking_variant', 'shadow')
    expect(data?.every((row) => row.product_id !== 'p-oos' && row.product_id !== 'p-b')).toBe(
      true
    )
  })
})
