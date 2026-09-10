/**
 * Pure helpers for Phase 2 knowledge classification, priority, confidence,
 * and numeric policy conflicts. No database access.
 */

import {
  POLICY_CONFLICT_CATEGORIES,
  type KnowledgeCategory,
  type KnowledgeConfidence,
  type KnowledgeConflict,
  type KnowledgeResult,
  type KnowledgeSource,
  type PolicyConflictCategory,
} from './knowledge-contracts';

/** Lower rank is more authoritative. generic_model is never retrieved. */
export const SOURCE_RANK: Record<KnowledgeSource, number> = {
  manual_kb: 1,
  catalog: 2,
  store_policy: 3,
  url_kb: 4,
  store_page: 4,
  generic_model: 5,
};

const CONFIDENCE_RANK: Record<KnowledgeConfidence, number> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3,
};

const CATEGORY_KEYWORDS: Array<{
  category: KnowledgeCategory;
  pattern: RegExp;
}> = [
  { category: 'RETURN', pattern: /\breturn(s|ing)?\b|മടക്ക|തിരികെ/i },
  { category: 'REFUND', pattern: /\brefund(s|ed|ing)?\b/i },
  { category: 'EXCHANGE', pattern: /\bexchang(e|es|ed)?\b/i },
  { category: 'SHIPPING', pattern: /\bship(ping|ped|ment)?\b|courier/i },
  { category: 'DELIVERY', pattern: /\bdeliver(y|ed|ies)?\b/i },
  {
    category: 'PAYMENT',
    pattern: /\b(payment|cod|upi|razorpay|prepaid|pay)\b/i,
  },
  { category: 'DISCOUNT', pattern: /\b(discount|coupon|promo|offer|% off)\b/i },
  { category: 'PRICING', pattern: /\b(price|pricing|cost|₹|inr|rs\.?)\b/i },
  { category: 'ORDER', pattern: /\b(order|tracking|track)\b/i },
  { category: 'CONTACT', pattern: /\b(phone|email|whatsapp|contact us)\b/i },
  { category: 'FAQ', pattern: /\bfaq\b|frequently asked/i },
  { category: 'POLICY', pattern: /\bpolic(y|ies)\b/i },
  { category: 'BUSINESS_INFO', pattern: /\b(about us|store hours|address)\b/i },
  { category: 'SALES', pattern: /\bsales\b/i },
  { category: 'MARKETING', pattern: /\b(campaign|marketing)\b/i },
  {
    category: 'PRODUCT',
    pattern: /\b(product|saree|sku|stock|catalog|variant)\b/i,
  },
];

const FACT_TOKEN =
  /(?:(\d+(?:\.\d+)?)\s*(days?|hours?|%|rs\.?|inr|₹)|(rs\.?|inr|₹)\s*(\d+(?:\.\d+)?))/i;

export function sourceRank(source: KnowledgeSource): number {
  return SOURCE_RANK[source];
}

export function classifyCategory(...texts: Array<string | null | undefined>): KnowledgeCategory {
  const hay = texts.filter(Boolean).join(' \n ');
  if (!hay.trim()) return 'OTHER';
  for (const { category, pattern } of CATEGORY_KEYWORDS) {
    if (pattern.test(hay)) return category;
  }
  return 'OTHER';
}

export function knowledgeConfidence(args: {
  source: KnowledgeSource;
  excerpt: string;
  catalogHasPriceOrStock?: boolean;
}): KnowledgeConfidence {
  const excerpt = args.excerpt.trim();
  if (!excerpt) return 'unknown';
  if (args.source === 'manual_kb' || args.source === 'store_policy') return 'high';
  if (args.source === 'url_kb' || args.source === 'store_page') return 'medium';
  if (args.source === 'catalog') {
    return args.catalogHasPriceOrStock ? 'medium' : 'low';
  }
  return 'unknown';
}

function normalizeFactUnit(unit: string): string {
  const cleaned = unit.toLowerCase().replace(/\.$/, '');
  if (cleaned === 'day') return 'days';
  if (cleaned === 'hour') return 'hours';
  if (cleaned === 'rs' || cleaned === '₹') return 'inr';
  return cleaned;
}

export function extractFactToken(text: string): string | null {
  const match = text.match(FACT_TOKEN);
  if (!match) return null;
  const amount = match[1] ?? match[4];
  const unit = match[2] ?? match[3];
  if (!amount || !unit) return null;
  return `${amount} ${normalizeFactUnit(unit)}`;
}

export function isPolicyConflictCategory(
  category: KnowledgeCategory
): category is PolicyConflictCategory {
  return (POLICY_CONFLICT_CATEGORIES as readonly string[]).includes(category);
}

export function compareKnowledgeResults(a: KnowledgeResult, b: KnowledgeResult): number {
  const rank = sourceRank(a.source) - sourceRank(b.source);
  if (rank !== 0) return rank;
  return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
}

export function detectKnowledgeConflicts(
  results: KnowledgeResult[]
): KnowledgeConflict[] {
  const grouped = new Map<KnowledgeCategory, KnowledgeResult[]>();
  for (const result of results) {
    if (!isPolicyConflictCategory(result.category)) continue;
    if (!extractFactToken(result.excerpt)) continue;
    const list = grouped.get(result.category) ?? [];
    list.push(result);
    grouped.set(result.category, list);
  }

  const conflicts: KnowledgeConflict[] = [];
  for (const [category, rows] of grouped) {
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const left = rows[i];
        const right = rows[j];
        const tokenA = extractFactToken(left.excerpt);
        const tokenB = extractFactToken(right.excerpt);
        if (!tokenA || !tokenB || tokenA === tokenB) continue;

        const rankA = sourceRank(left.source);
        const rankB = sourceRank(right.source);
        if (rankA === rankB) {
          conflicts.push({
            category,
            tokens: [tokenA, tokenB],
            resultIds: [left.id, right.id],
            unresolved: true,
          });
          continue;
        }
        const winner = rankA < rankB ? left : right;
        conflicts.push({
          category,
          tokens: [tokenA, tokenB],
          resultIds: [left.id, right.id],
          unresolved: false,
          winnerId: winner.id,
        });
      }
    }
  }
  return conflicts;
}

/** Drop losing results when a conflict was resolved by source rank. */
export function applyResolvedConflicts(
  results: KnowledgeResult[],
  conflicts: KnowledgeConflict[]
): KnowledgeResult[] {
  const losers = new Set<string>();
  for (const conflict of conflicts) {
    if (conflict.unresolved || !conflict.winnerId) continue;
    for (const id of conflict.resultIds) {
      if (id !== conflict.winnerId) losers.add(id);
    }
  }
  if (losers.size === 0) return results;
  return results.filter((row) => !losers.has(row.id));
}

export function knowledgeResultId(
  source: KnowledgeSource,
  ref: { chunkId?: string; documentId?: string; handle?: string; productId?: string }
): string {
  return [
    source,
    ref.chunkId ?? ref.documentId ?? ref.handle ?? ref.productId ?? 'unknown',
  ].join(':');
}
