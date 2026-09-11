/**
 * Admin read/config helpers for the AI Intelligence UI.
 * Does not change discovery, retrieval scoring, or experiment rules.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAccountId } from './contracts'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import {
  loadSalesPatternRetrievalMode,
  type SalesPatternRetrievalMode,
} from './retrieve-sales-patterns'
import { loadAiBehaviorOptimizationMode } from './assign-ai-behavior'
import { parseAiBehaviorConfig } from './ai-behavior-config'
import type { AiBehaviorConfig } from './ai-behavior-types'

export const PATTERN_ADMIN_COLUMNS =
  'id, pattern_key, pattern_type, trigger_event_type, context, recommended_behavior, evidence, confidence, sample_count, success_count, failure_count, eligible_outcome_count, unresolved_count, status, retrieval_eligible, effectiveness, analyzer_version, first_observed_at, last_observed_at, last_evaluated_at, last_effectiveness_at, created_at, updated_at'

export type SalesPatternAdminRow = {
  id: string
  pattern_key: string
  pattern_type: string
  trigger_event_type: string
  context: unknown
  recommended_behavior: string
  evidence: unknown
  confidence: number
  sample_count: number
  success_count: number
  failure_count: number
  eligible_outcome_count: number
  unresolved_count: number
  status: string
  retrieval_eligible: boolean | null
  effectiveness: unknown
  analyzer_version: string
  first_observed_at: string | null
  last_observed_at: string | null
  last_evaluated_at: string | null
  last_effectiveness_at: string | null
  created_at: string
  updated_at: string
}

export function isIntelligenceRelationMissing(
  error: { message?: string; code?: string } | null,
  relation: string
): boolean {
  return isMissingDbRelation(error, relation)
}

export async function setSalesPatternRetrievalMode(
  db: SupabaseClient,
  accountId: string,
  mode: SalesPatternRetrievalMode
): Promise<SalesPatternRetrievalMode> {
  const id = requireAccountId(accountId, 'setSalesPatternRetrievalMode')
  const next = mode === 'shadow' || mode === 'on' ? mode : 'off'
  const { error } = await db
    .from('ai_configs')
    .update({ sales_pattern_retrieval: next })
    .eq('account_id', id)
  if (error) throw error
  return next
}

export async function loadIntelligenceOverview(
  db: SupabaseClient,
  accountId: string
): Promise<{
  knowledge: { available: boolean; document_count: number; last_updated_at: string | null }
  patterns: {
    available: boolean
    by_status: Record<string, number>
    retrieval_eligible_count: number
    with_effectiveness_count: number
    underperforming_count: number
    last_observed_at: string | null
  }
  experiments: { available: boolean; by_status: Record<string, number> }
  flags: {
    sales_pattern_retrieval: SalesPatternRetrievalMode
    ai_behavior_optimization: 'off' | 'on'
  }
}> {
  const id = requireAccountId(accountId, 'loadIntelligenceOverview')
  const [knowledge, patterns, experiments, retrieval, optimization] =
    await Promise.all([
      loadKnowledgeSummary(db, id),
      loadPatternSummary(db, id),
      loadExperimentSummary(db, id),
      loadSalesPatternRetrievalMode(db, id),
      loadAiBehaviorOptimizationMode(db, id),
    ])
  return {
    knowledge,
    patterns,
    experiments,
    flags: {
      sales_pattern_retrieval: retrieval,
      ai_behavior_optimization: optimization,
    },
  }
}

export async function listAccountSalesPatterns(
  db: SupabaseClient,
  accountId: string
): Promise<{ available: boolean; patterns: SalesPatternAdminRow[] }> {
  const id = requireAccountId(accountId, 'listAccountSalesPatterns')
  const { data, error } = await db
    .from('sales_patterns')
    .select(PATTERN_ADMIN_COLUMNS)
    .eq('account_id', id)
    .order('last_observed_at', { ascending: false, nullsFirst: false })
  if (error) {
    if (isIntelligenceRelationMissing(error, 'sales_patterns')) {
      return { available: false, patterns: [] }
    }
    throw error
  }
  return { available: true, patterns: (data ?? []) as SalesPatternAdminRow[] }
}

export async function getAccountSalesPattern(
  db: SupabaseClient,
  accountId: string,
  patternId: string
): Promise<
  | { available: false; pattern: null }
  | { available: true; pattern: SalesPatternAdminRow | null }
> {
  const id = requireAccountId(accountId, 'getAccountSalesPattern')
  const { data, error } = await db
    .from('sales_patterns')
    .select(PATTERN_ADMIN_COLUMNS)
    .eq('account_id', id)
    .eq('id', patternId)
    .maybeSingle()
  if (error) {
    if (isIntelligenceRelationMissing(error, 'sales_patterns')) {
      return { available: false, pattern: null }
    }
    throw error
  }
  return { available: true, pattern: (data as SalesPatternAdminRow | null) ?? null }
}

export async function loadExperimentConfigExtras(
  db: SupabaseClient,
  accountId: string
): Promise<{
  active_behavior: { version: number; behavior: AiBehaviorConfig } | null
  live_experiment: {
    id: string
    name: string
    status: string
    variant_allocation: number
  } | null
}> {
  const id = requireAccountId(accountId, 'loadExperimentConfigExtras')
  const [{ data: active }, { data: live, error: liveErr }] = await Promise.all([
    db
      .from('ai_behavior_versions')
      .select('version, behavior')
      .eq('account_id', id)
      .eq('status', 'active')
      .maybeSingle(),
    db
      .from('ai_behavior_experiments')
      .select('id, name, status, variant_allocation')
      .eq('account_id', id)
      .in('status', ['running', 'evaluating'])
      .maybeSingle(),
  ])
  if (liveErr && isIntelligenceRelationMissing(liveErr, 'ai_behavior_experiments')) {
    return { active_behavior: null, live_experiment: null }
  }
  let activeBehavior: { version: number; behavior: AiBehaviorConfig } | null = null
  if (active) {
    try {
      activeBehavior = {
        version: (active as { version: number }).version,
        behavior: parseAiBehaviorConfig((active as { behavior: unknown }).behavior),
      }
    } catch {
      activeBehavior = null
    }
  }
  return {
    active_behavior: activeBehavior,
    live_experiment: (live as {
      id: string
      name: string
      status: string
      variant_allocation: number
    } | null) ?? null,
  }
}

export async function getAccountExperimentDetail(
  db: SupabaseClient,
  accountId: string,
  experimentId: string
): Promise<{
  experiment: Record<string, unknown>
  control_behavior: AiBehaviorConfig | null
  variant_behavior: AiBehaviorConfig | null
} | null> {
  const id = requireAccountId(accountId, 'getAccountExperimentDetail')
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select(
      'id, name, objective, control_version_id, variant_version_id, control_was_implicit, variant_allocation, status, started_at, ended_at, evaluation, candidate_winner_version_id, created_at, updated_at'
    )
    .eq('account_id', id)
    .eq('id', experimentId)
    .maybeSingle()
  if (error) {
    if (isIntelligenceRelationMissing(error, 'ai_behavior_experiments')) {
      return null
    }
    throw error
  }
  if (!data) return null
  const row = data as {
    control_version_id: string
    variant_version_id: string
  } & Record<string, unknown>
  const { data: versions } = await db
    .from('ai_behavior_versions')
    .select('id, behavior')
    .eq('account_id', id)
    .in('id', [row.control_version_id, row.variant_version_id])
  const byId = new Map(
    ((versions ?? []) as Array<{ id: string; behavior: unknown }>).map((v) => [
      v.id,
      safeBehavior(v.behavior),
    ])
  )
  return {
    experiment: row,
    control_behavior: byId.get(row.control_version_id) ?? null,
    variant_behavior: byId.get(row.variant_version_id) ?? null,
  }
}

function safeBehavior(raw: unknown): AiBehaviorConfig | null {
  try {
    return parseAiBehaviorConfig(raw)
  } catch {
    return null
  }
}

async function loadKnowledgeSummary(
  db: SupabaseClient,
  accountId: string
): Promise<{
  available: boolean
  document_count: number
  last_updated_at: string | null
}> {
  const { data, error } = await db
    .from('ai_knowledge_documents')
    .select('updated_at')
    .eq('account_id', accountId)
    .order('updated_at', { ascending: false })
  if (error) {
    if (isIntelligenceRelationMissing(error, 'ai_knowledge_documents')) {
      return { available: false, document_count: 0, last_updated_at: null }
    }
    throw error
  }
  const rows = (data ?? []) as Array<{ updated_at: string | null }>
  return {
    available: true,
    document_count: rows.length,
    last_updated_at: rows[0]?.updated_at ?? null,
  }
}

async function loadPatternSummary(
  db: SupabaseClient,
  accountId: string
): Promise<{
  available: boolean
  by_status: Record<string, number>
  retrieval_eligible_count: number
  with_effectiveness_count: number
  underperforming_count: number
  last_observed_at: string | null
}> {
  const empty = {
    available: false,
    by_status: { candidate: 0, active: 0, stale: 0, archived: 0 },
    retrieval_eligible_count: 0,
    with_effectiveness_count: 0,
    underperforming_count: 0,
    last_observed_at: null as string | null,
  }
  const { data, error } = await db
    .from('sales_patterns')
    .select('status, retrieval_eligible, effectiveness, last_observed_at')
    .eq('account_id', accountId)
  if (error) {
    if (isIntelligenceRelationMissing(error, 'sales_patterns')) return empty
    throw error
  }
  const byStatus = { candidate: 0, active: 0, stale: 0, archived: 0 }
  let eligible = 0
  let withEffectiveness = 0
  let underperforming = 0
  let lastObserved: string | null = null
  for (const row of (data ?? []) as Array<{
    status: string
    retrieval_eligible: boolean | null
    effectiveness: unknown
    last_observed_at: string | null
  }>) {
    if (row.status in byStatus) {
      byStatus[row.status as keyof typeof byStatus] += 1
    }
    if (row.retrieval_eligible === true) eligible += 1
    if (row.retrieval_eligible === false) underperforming += 1
    const usage = effectivenessEligibleCount(row.effectiveness)
    if (usage > 0) withEffectiveness += 1
    if (
      row.last_observed_at &&
      (!lastObserved || row.last_observed_at > lastObserved)
    ) {
      lastObserved = row.last_observed_at
    }
  }
  return {
    available: true,
    by_status: byStatus,
    retrieval_eligible_count: eligible,
    with_effectiveness_count: withEffectiveness,
    underperforming_count: underperforming,
    last_observed_at: lastObserved,
  }
}

async function loadExperimentSummary(
  db: SupabaseClient,
  accountId: string
): Promise<{ available: boolean; by_status: Record<string, number> }> {
  const byStatus = {
    draft: 0,
    running: 0,
    evaluating: 0,
    approved: 0,
    rolled_back: 0,
    archived: 0,
  }
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select('status')
    .eq('account_id', accountId)
  if (error) {
    if (isIntelligenceRelationMissing(error, 'ai_behavior_experiments')) {
      return { available: false, by_status: byStatus }
    }
    throw error
  }
  for (const row of (data ?? []) as Array<{ status: string }>) {
    if (row.status in byStatus) {
      byStatus[row.status as keyof typeof byStatus] += 1
    }
  }
  return { available: true, by_status: byStatus }
}

function effectivenessEligibleCount(raw: unknown): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
  const value = (raw as { eligibleUsageCount?: unknown }).eligibleUsageCount
  return typeof value === 'number' && value > 0 ? value : 0
}
