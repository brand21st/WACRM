import { describe, expect, it } from 'vitest';
import type { KnowledgeResult } from './knowledge-contracts';
import {
  applyResolvedConflicts,
  classifyCategory,
  compareKnowledgeResults,
  detectKnowledgeConflicts,
  extractFactToken,
  knowledgeConfidence,
  knowledgeResultId,
  sourceRank,
} from './knowledge-sources';

function result(
  partial: Pick<KnowledgeResult, 'id' | 'source' | 'category' | 'excerpt'> &
    Partial<KnowledgeResult>
): KnowledgeResult {
  return {
    confidence: 'high',
    ref: {},
    ...partial,
  };
}

describe('classifyCategory', () => {
  it('classifies policy-like queries', () => {
    expect(classifyCategory('What is the return policy?')).toBe('RETURN');
    expect(classifyCategory('refund timeline')).toBe('REFUND');
    expect(classifyCategory('shipping charges')).toBe('SHIPPING');
    expect(classifyCategory('pay by UPI or COD')).toBe('PAYMENT');
  });

  it('falls back to OTHER when nothing matches', () => {
    expect(classifyCategory('hello')).toBe('OTHER');
    expect(classifyCategory('')).toBe('OTHER');
  });

  it('uses title plus excerpt when the query is vague', () => {
    expect(classifyCategory('info', 'Return within 7 days')).toBe('RETURN');
  });
});

describe('sourceRank and confidence', () => {
  it('ranks manual KB above catalog and store pages', () => {
    expect(sourceRank('manual_kb')).toBeLessThan(sourceRank('catalog'));
    expect(sourceRank('catalog')).toBeLessThan(sourceRank('store_policy'));
    expect(sourceRank('store_policy')).toBeLessThan(sourceRank('store_page'));
    expect(sourceRank('url_kb')).toBe(sourceRank('store_page'));
    expect(sourceRank('generic_model')).toBeGreaterThan(sourceRank('store_page'));
  });

  it('assigns deterministic confidence from source and excerpt', () => {
    expect(
      knowledgeConfidence({ source: 'manual_kb', excerpt: 'Returns in 7 days' })
    ).toBe('high');
    expect(
      knowledgeConfidence({ source: 'store_policy', excerpt: 'Refunds in 3 days' })
    ).toBe('high');
    expect(
      knowledgeConfidence({ source: 'url_kb', excerpt: 'See our FAQ' })
    ).toBe('medium');
    expect(
      knowledgeConfidence({
        source: 'catalog',
        excerpt: 'Red saree — 4999 INR',
        catalogHasPriceOrStock: true,
      })
    ).toBe('medium');
    expect(
      knowledgeConfidence({
        source: 'catalog',
        excerpt: 'Red saree',
        catalogHasPriceOrStock: false,
      })
    ).toBe('low');
    expect(knowledgeConfidence({ source: 'manual_kb', excerpt: '  ' })).toBe(
      'unknown'
    );
  });
});

describe('extractFactToken', () => {
  it('normalizes the first number and unit', () => {
    expect(extractFactToken('Return within 7 days.')).toBe('7 days');
    expect(extractFactToken('Ships in 24 hours')).toBe('24 hours');
    expect(extractFactToken('10% off prepaid')).toBe('10 %');
    expect(extractFactToken('from Rs. 999')).toBe('999 inr');
  });

  it('returns null when there is no comparable fact', () => {
    expect(extractFactToken('We accept returns')).toBeNull();
  });
});

describe('detectKnowledgeConflicts', () => {
  it('resolves different ranks in favor of the more authoritative source', () => {
    const rows = [
      result({
        id: 'manual',
        source: 'manual_kb',
        category: 'RETURN',
        excerpt: 'Return within 7 days',
      }),
      result({
        id: 'page',
        source: 'store_page',
        category: 'RETURN',
        excerpt: 'Return within 15 days',
      }),
    ];
    const conflicts = detectKnowledgeConflicts(rows);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unresolved).toBe(false);
    expect(conflicts[0].winnerId).toBe('manual');
    expect(applyResolvedConflicts(rows, conflicts).map((r) => r.id)).toEqual([
      'manual',
    ]);
  });

  it('marks same-rank conflicting days as unresolved and keeps both', () => {
    const rows = [
      result({
        id: 'url',
        source: 'url_kb',
        category: 'RETURN',
        excerpt: 'Return within 7 days',
      }),
      result({
        id: 'page',
        source: 'store_page',
        category: 'RETURN',
        excerpt: 'Return within 15 days',
      }),
    ];
    const conflicts = detectKnowledgeConflicts(rows);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].unresolved).toBe(true);
    expect(conflicts[0].winnerId).toBeUndefined();
    expect(applyResolvedConflicts(rows, conflicts)).toHaveLength(2);
  });

  it('ignores non-policy categories and matching tokens', () => {
    expect(
      detectKnowledgeConflicts([
        result({
          id: 'a',
          source: 'manual_kb',
          category: 'PRODUCT',
          excerpt: '7 days delivery for this sku',
        }),
        result({
          id: 'b',
          source: 'manual_kb',
          category: 'RETURN',
          excerpt: 'Return within 7 days',
        }),
        result({
          id: 'c',
          source: 'store_page',
          category: 'RETURN',
          excerpt: 'Returns accepted within 7 days',
        }),
      ])
    ).toEqual([]);
  });
});

describe('compareKnowledgeResults', () => {
  it('sorts by source rank then confidence', () => {
    const rows = [
      result({
        id: 'page',
        source: 'store_page',
        category: 'OTHER',
        excerpt: 'x',
        confidence: 'medium',
      }),
      result({
        id: 'manual',
        source: 'manual_kb',
        category: 'OTHER',
        excerpt: 'x',
        confidence: 'high',
      }),
    ];
    expect([...rows].sort(compareKnowledgeResults).map((r) => r.id)).toEqual([
      'manual',
      'page',
    ]);
  });
});

describe('knowledgeResultId', () => {
  it('is stable from source plus ref', () => {
    expect(knowledgeResultId('manual_kb', { chunkId: 'c1' })).toBe(
      'manual_kb:c1'
    );
  });
});
