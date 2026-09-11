import type { SupabaseClient } from '@supabase/supabase-js'
import { getCatalogProductsByIds } from './facts'
import {
  BASELINE_RECOMMENDATION_ALGORITHM,
  LEARNED_RECOMMENDATION_ALGORITHM,
  recordRecommendationEvidence,
  type RecommendationEvidenceRow,
} from './recommendation-evidence'
import type { RecommendReason } from './types'

export type RecommendationIntelligenceMode = 'off' | 'shadow'

export async function loadRecommendationIntelligenceMode(
  db: SupabaseClient,
  accountId: string
): Promise<RecommendationIntelligenceMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('recommendation_intelligence')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) return 'off'
    return data?.recommendation_intelligence === 'shadow' ? 'shadow' : 'off'
  } catch {
    return 'off'
  }
}

export async function materializeRecommendationShadows(
  db: SupabaseClient,
  accountId: string,
  evidence: RecommendationEvidenceRow[]
): Promise<number> {
  if ((await loadRecommendationIntelligenceMode(db, accountId)) !== 'shadow')
    return 0
  const baseline = evidence.filter(
    (row) =>
      row.account_id === accountId &&
      row.event === 'generated' &&
      row.ranking_variant === 'baseline' &&
      !row.is_shadow &&
      row.product_id
  )
  if (!baseline.length) return 0
  const shadowed = new Set(
    evidence
      .filter(
        (row) =>
          row.account_id === accountId &&
          row.event === 'generated' &&
          row.ranking_variant === 'shadow'
      )
      .map((row) => row.recommendation_set_id)
  )
  const productIds = [...new Set(baseline.flatMap((row) => row.product_id ?? []))]
  const products = await getCatalogProductsByIds(db, accountId, productIds)
  const safeProducts = new Map(
    products
      .filter(
        (product) =>
          product.accountId === accountId &&
          product.status === 'active' &&
          product.variants.some((variant) => variant.available)
      )
      .map((product) => [product.id, product])
  )
  const { data: stats, error } = await db
    .from('catalog_recommendation_stats')
    .select(
      'product_id, mode, smoothed_selection_rate, smoothed_rejection_rate, shown_count'
    )
    .eq('account_id', accountId)
    .eq('algorithm_version', BASELINE_RECOMMENDATION_ALGORITHM)
    .in('product_id', productIds)
  if (error) throw error
  const learned = new Map(
    (stats ?? []).map((row) => [
      `${String(row.mode)}:${String(row.product_id)}`,
      {
        score:
          Number(row.smoothed_selection_rate ?? 0.5) -
          Number(row.smoothed_rejection_rate ?? 0.5),
        samples: Math.max(0, Number(row.shown_count) || 0),
      },
    ])
  )
  const sets = new Map<string, RecommendationEvidenceRow[]>()
  for (const row of baseline) {
    if (shadowed.has(row.recommendation_set_id)) continue
    const rows = sets.get(row.recommendation_set_id) ?? []
    rows.push(row)
    sets.set(row.recommendation_set_id, rows)
  }
  let written = 0
  for (const [setId, rows] of sets) {
    const ordered = rows
      .filter((row) => row.product_id && safeProducts.has(row.product_id))
      .map((row, index) => ({
        row,
        baselineIndex: row.baseline_rank ?? row.rank ?? index + 1,
        learned: learned.get(`${row.mode}:${row.product_id}`),
      }))
      .sort((a, b) => {
        const aWeight = a.learned
          ? a.learned.score * Math.min(1, a.learned.samples / 10)
          : 0
        const bWeight = b.learned
          ? b.learned.score * Math.min(1, b.learned.samples / 10)
          : 0
        return bWeight - aWeight || a.baselineIndex - b.baselineIndex
      })
    if (!ordered.length) continue
    const first = ordered[0].row
    await recordRecommendationEvidence(db, {
      accountId,
      recommendationSetId: setId,
      contactId: first.contact_id,
      conversationId: first.conversation_id,
      sourceMessageId: first.source_message_id,
      sourceTurnId: first.source_turn_id,
      mode: first.mode,
      seedProductId: first.seed_product_id,
      rows: ordered.map(({ row, baselineIndex }, index) => ({
        product: safeProducts.get(row.product_id!)!,
        score: Number(row.score) || 0,
        reasons: (row.reasons ?? []) as RecommendReason[],
        baselineRank: baselineIndex,
        shadowRank: index + 1,
      })),
      event: 'generated',
      algorithmVersion: LEARNED_RECOMMENDATION_ALGORITHM,
      rankingVariant: 'shadow',
      isShadow: true,
      isInjected: false,
    })
    written += ordered.length
  }
  return written
}
