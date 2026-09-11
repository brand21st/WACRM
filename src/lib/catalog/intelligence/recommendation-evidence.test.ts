import { describe, expect, it } from 'vitest';
import {
  attributeRecommendationOutcomes,
  stableRecommendationSetId,
  type RecommendationEvidenceRow,
} from './recommendation-evidence';

const base: RecommendationEvidenceRow = {
  account_id: 'acct-a',
  recommendation_set_id: 'set-a',
  conversation_id: 'conv-a',
  mode: 'recommend',
  product_id: 'product-a',
  event: 'shown',
  algorithm_version: 'catalog-baseline-v1',
  ranking_variant: 'baseline',
  is_shadow: false,
  is_injected: true,
  created_at: '2026-09-11T04:00:00.000Z',
};

describe('stableRecommendationSetId', () => {
  it('is deterministic and account scoped', () => {
    const input = {
      accountId: 'acct-a',
      conversationId: 'conv-a',
      sourceMessageId: 'message-a',
      mode: 'recommend',
      productIds: ['product-b', 'product-a'],
    };
    expect(stableRecommendationSetId(input)).toBe(
      stableRecommendationSetId(input)
    );
    expect(stableRecommendationSetId(input)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(
      stableRecommendationSetId({ ...input, accountId: 'acct-b' })
    ).not.toBe(stableRecommendationSetId(input));
  });
});

describe('attributeRecommendationOutcomes', () => {
  it('attributes a mapped outcome to one injected set', () => {
    const actions = attributeRecommendationOutcomes(
      [base],
      [
        {
          id: 'outcome-a',
          account_id: 'acct-a',
          conversation_id: 'conv-a',
          product_id: 'product-a',
          event: 'purchase',
          created_at: '2026-09-11T04:05:00.000Z',
        },
      ]
    );
    expect(actions).toEqual([
      expect.objectContaining({
        recommendationSetId: 'set-a',
        productId: 'product-a',
        action: 'selected',
        confidence: 'mapped',
      }),
    ]);
  });

  it('counts add-to-cart and purchase as one observational selection', () => {
    const actions = attributeRecommendationOutcomes(
      [base],
      [
        {
          id: 'cart-a',
          account_id: 'acct-a',
          conversation_id: 'conv-a',
          product_id: 'product-a',
          event: 'add_to_cart',
          created_at: '2026-09-11T04:04:00.000Z',
        },
        {
          id: 'purchase-a',
          account_id: 'acct-a',
          conversation_id: 'conv-a',
          product_id: 'product-a',
          event: 'purchase',
          created_at: '2026-09-11T04:05:00.000Z',
        },
      ]
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]?.action).toBe('selected');
  });

  it('does not guess when recommendation sets co-occur', () => {
    const actions = attributeRecommendationOutcomes(
      [
        base,
        { ...base, recommendation_set_id: 'set-b' },
        {
          ...base,
          recommendation_set_id: 'shadow-only',
          ranking_variant: 'shadow',
          is_shadow: true,
          is_injected: false,
        },
      ],
      [
        {
          id: 'outcome-a',
          account_id: 'acct-a',
          conversation_id: 'conv-a',
          product_id: 'product-a',
          event: 'add_to_cart',
          created_at: '2026-09-11T04:05:00.000Z',
        },
      ]
    );
    expect(actions).toHaveLength(2);
    expect(actions.every((action) => action.action === 'unresolved')).toBe(
      true
    );
    expect(actions.map((action) => action.recommendationSetId).sort()).toEqual([
      'set-a',
      'set-b',
    ]);
  });

  it('keeps an unmapped singleton outcome unresolved', () => {
    const [action] = attributeRecommendationOutcomes(
      [base],
      [
        {
          id: 'outcome-a',
          account_id: 'acct-a',
          conversation_id: 'conv-a',
          product_id: null,
          event: 'purchase',
          created_at: '2026-09-11T04:05:00.000Z',
        },
      ]
    );
    expect(action).toMatchObject({
      productId: 'product-a',
      action: 'unresolved',
      confidence: 'unmapped',
    });
  });
});
