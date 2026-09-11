/**
 * Phase 7 async evaluation. Recomputes from assignments + sales_events.
 * Never auto-promotes or auto-rollbacks.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ACCOUNTS_PER_CRON } from './sales-pattern-types'
import { requireAccountId } from './contracts'
import {
  AI_BEHAVIOR_ANALYZER_VERSION,
  MAX_ASSIGNMENTS_PER_ACCOUNT,
  attributionFromEventType,
  attributionWindowEnd,
  decideExperimentOutcome,
  emptyArmMetrics,
  isTerminalOutcomeType,
  observedFailureRate,
  observedSuccessRate,
  optimizationIdempotencyKey,
  type ArmMetrics,
  type AssignedVariant,
  type AttributionStatus,
  type ExperimentEvaluation,
  type ExperimentStatus,
} from './ai-behavior-types'

export type AssignmentEvalRow = {
  id: string
  account_id: string
  experiment_id: string
  conversation_id: string
  assigned_variant: AssignedVariant
  assigned_at: string
  attribution_status: AttributionStatus
  attributed_event_id: string | null
  attributed_event_type: string | null
}

export type TerminalSalesEventRow = {
  id: string
  account_id: string
  conversation_id: string
  event_type: string
  kind: string
  created_at: string
}

export type LiveExperimentEvalRow = {
  id: string
  account_id: string
  status: ExperimentStatus
  started_at: string | null
  variant_version_id: string
}

export type AssignmentAttribution = {
  id: string
  attribution_status: AttributionStatus
  attributed_event_id: string | null
  attributed_event_type: string | null
}

export type OptimizationJob = {
  accountId: string
  idempotencyKey: string
}

export type EvaluateAiBehaviorDeps = {
  loadLiveExperiments?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<LiveExperimentEvalRow[]>
  loadAssignments?: (
    db: SupabaseClient,
    accountId: string,
    experimentIds: string[]
  ) => Promise<AssignmentEvalRow[]>
  loadTerminalEvents?: (
    db: SupabaseClient,
    accountId: string,
    conversationIds: string[]
  ) => Promise<TerminalSalesEventRow[]>
  writeAttributions?: (
    db: SupabaseClient,
    accountId: string,
    rows: AssignmentAttribution[]
  ) => Promise<void>
  writeEvaluation?: (
    db: SupabaseClient,
    accountId: string,
    experimentId: string,
    payload: {
      evaluation: ExperimentEvaluation
      status: ExperimentStatus
      candidateWinnerVersionId: string | null
    }
  ) => Promise<void>
  upsertCursor?: (db: SupabaseClient, accountId: string) => Promise<void>
}

export function attributeAssignment(
  assignment: AssignmentEvalRow,
  events: TerminalSalesEventRow[]
): AssignmentAttribution {
  const assignedAt = Date.parse(assignment.assigned_at)
  if (!Number.isFinite(assignedAt)) {
    return unresolved(assignment.id)
  }
  const windowEnd = attributionWindowEnd(assignment.assigned_at).getTime()
  const later = events.filter((event) => {
    if (event.account_id !== assignment.account_id) return false
    if (event.conversation_id !== assignment.conversation_id) return false
    if (event.kind !== 'outcome') return false
    if (!isTerminalOutcomeType(event.event_type)) return false
    const created = Date.parse(event.created_at)
    if (!Number.isFinite(created)) return false
    return created > assignedAt && created <= windowEnd
  })
  later.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const latest = later[0]
  if (!latest) return unresolved(assignment.id)
  return {
    id: assignment.id,
    attribution_status: attributionFromEventType(latest.event_type),
    attributed_event_id: latest.id,
    attributed_event_type: latest.event_type,
  }
}

export function rollupArmMetrics(
  rows: Array<Pick<AssignmentEvalRow, 'assigned_variant'> & AssignmentAttribution>
): { control: ArmMetrics; variant: ArmMetrics } {
  const control = emptyArmMetrics()
  const variant = emptyArmMetrics()
  for (const row of rows) {
    const arm = row.assigned_variant === 'variant' ? variant : control
    arm.assignedCount += 1
    if (row.attribution_status === 'success') {
      arm.successCount += 1
      arm.eligibleOutcomeCount += 1
    } else if (row.attribution_status === 'failure') {
      arm.failureCount += 1
      arm.eligibleOutcomeCount += 1
    } else {
      arm.unresolvedCount += 1
    }
    arm.observedSuccessRate = observedSuccessRate(arm.successCount, arm.failureCount)
    arm.failureRate = observedFailureRate(arm.successCount, arm.failureCount)
  }
  return { control, variant }
}

export async function evaluateAccountAiBehaviorExperiments(
  db: SupabaseClient,
  accountId: string,
  deps: EvaluateAiBehaviorDeps = {}
): Promise<{
  accountId: string
  experimentCount: number
  assignmentCount: number
  skipped: boolean
}> {
  const id = requireAccountId(accountId, 'evaluateAccountAiBehaviorExperiments')
  const loadLive = deps.loadLiveExperiments ?? loadLiveExperiments
  const experiments = (await loadLive(db, id)).filter(
    (row) => row.account_id === id
  )
  if (!experiments.length) {
    await (deps.upsertCursor ?? upsertOptimizationCursor)(db, id)
    return { accountId: id, experimentCount: 0, assignmentCount: 0, skipped: true }
  }

  const experimentIds = experiments.map((row) => row.id)
  const loadAssignments = deps.loadAssignments ?? loadAccountAssignments
  const assignments = (await loadAssignments(db, id, experimentIds)).filter(
    (row) => row.account_id === id
  )
  const conversationIds = [...new Set(assignments.map((row) => row.conversation_id))]
  const loadEvents = deps.loadTerminalEvents ?? loadAccountTerminalEvents
  const events = (await loadEvents(db, id, conversationIds)).filter(
    (row) => row.account_id === id
  )

  const attributed = assignments.map((row) => ({
    ...row,
    ...attributeAssignment(row, events),
  }))
  await (deps.writeAttributions ?? persistAttributions)(
    db,
    id,
    attributed.map((row) => ({
      id: row.id,
      attribution_status: row.attribution_status,
      attributed_event_id: row.attributed_event_id,
      attributed_event_type: row.attributed_event_type,
    }))
  )

  const writeEvaluation = deps.writeEvaluation ?? persistEvaluation
  for (const experiment of experiments) {
    const rows = attributed.filter((row) => row.experiment_id === experiment.id)
    const { control, variant } = rollupArmMetrics(rows)
    const decision = decideExperimentOutcome({
      control,
      variant,
      startedAt: experiment.started_at,
      variantVersionId: experiment.variant_version_id,
    })
    const nextStatus =
      experiment.status === 'evaluating' ? 'evaluating' : decision.nextStatus
    const evaluation: ExperimentEvaluation = {
      control,
      variant,
      observedImprovement: decision.observedImprovement,
      candidateWinnerVersionId: decision.candidateWinnerVersionId,
      reason: decision.reason,
    }
    await writeEvaluation(db, id, experiment.id, {
      evaluation,
      status: nextStatus,
      candidateWinnerVersionId: decision.candidateWinnerVersionId,
    })
    console.info('[ai-behavior-optimization]', {
      accountId: id,
      experimentId: experiment.id,
      status: nextStatus,
      reason: decision.reason,
      observedImprovement: decision.observedImprovement,
    })
  }

  await (deps.upsertCursor ?? upsertOptimizationCursor)(db, id)
  return {
    accountId: id,
    experimentCount: experiments.length,
    assignmentCount: assignments.length,
    skipped: false,
  }
}

export async function drainAiBehaviorOptimizationJobs(
  db: SupabaseClient,
  opts: {
    limit?: number
    enqueue?: (job: OptimizationJob) => Promise<boolean>
    evaluate?: typeof evaluateAccountAiBehaviorExperiments
    listDue?: typeof listAccountsDueForOptimization
  } = {}
): Promise<{ queued: number; ran: number; accounts: string[] }> {
  const listDue = opts.listDue ?? listAccountsDueForOptimization
  const accounts = await listDue(db, opts.limit ?? ACCOUNTS_PER_CRON)
  let queued = 0
  let ran = 0
  const evaluate = opts.evaluate ?? evaluateAccountAiBehaviorExperiments
  for (const accountId of accounts) {
    const job: OptimizationJob = {
      accountId,
      idempotencyKey: optimizationIdempotencyKey(accountId),
    }
    const enqueued = opts.enqueue ? await opts.enqueue(job) : false
    if (enqueued) {
      queued += 1
      continue
    }
    await evaluate(db, accountId)
    ran += 1
  }
  return { queued, ran, accounts }
}

export async function listAccountsDueForOptimization(
  db: SupabaseClient,
  limit = ACCOUNTS_PER_CRON
): Promise<string[]> {
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select('account_id')
    .in('status', ['running', 'evaluating'])
    .limit(limit)
  if (error) throw error
  const seen = new Set<string>()
  const accounts: string[] = []
  for (const row of (data ?? []) as Array<{ account_id: string }>) {
    if (!row.account_id || seen.has(row.account_id)) continue
    seen.add(row.account_id)
    accounts.push(row.account_id)
    if (accounts.length >= limit) break
  }
  return accounts
}

async function loadLiveExperiments(
  db: SupabaseClient,
  accountId: string
): Promise<LiveExperimentEvalRow[]> {
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select('id, account_id, status, started_at, variant_version_id')
    .eq('account_id', accountId)
    .in('status', ['running', 'evaluating'])
  if (error) throw error
  return (data ?? []) as LiveExperimentEvalRow[]
}

async function loadAccountAssignments(
  db: SupabaseClient,
  accountId: string,
  experimentIds: string[]
): Promise<AssignmentEvalRow[]> {
  if (!experimentIds.length) return []
  const { data, error } = await db
    .from('ai_behavior_assignments')
    .select(
      'id, account_id, experiment_id, conversation_id, assigned_variant, assigned_at, attribution_status, attributed_event_id, attributed_event_type'
    )
    .eq('account_id', accountId)
    .in('experiment_id', experimentIds)
    .order('assigned_at', { ascending: false })
    .limit(MAX_ASSIGNMENTS_PER_ACCOUNT)
  if (error) throw error
  return (data ?? []) as AssignmentEvalRow[]
}

async function loadAccountTerminalEvents(
  db: SupabaseClient,
  accountId: string,
  conversationIds: string[]
): Promise<TerminalSalesEventRow[]> {
  if (!conversationIds.length) return []
  const { data, error } = await db
    .from('sales_events')
    .select('id, account_id, conversation_id, event_type, kind, created_at')
    .eq('account_id', accountId)
    .eq('kind', 'outcome')
    .in('conversation_id', conversationIds)
  if (error) throw error
  return ((data ?? []) as TerminalSalesEventRow[]).filter((row) =>
    isTerminalOutcomeType(row.event_type)
  )
}

async function persistAttributions(
  db: SupabaseClient,
  accountId: string,
  rows: AssignmentAttribution[]
): Promise<void> {
  const now = new Date().toISOString()
  for (const row of rows) {
    const { error } = await db
      .from('ai_behavior_assignments')
      .update({
        attribution_status: row.attribution_status,
        attributed_event_id: row.attributed_event_id,
        attributed_event_type: row.attributed_event_type,
        updated_at: now,
      })
      .eq('account_id', accountId)
      .eq('id', row.id)
    if (error) throw error
  }
}

async function persistEvaluation(
  db: SupabaseClient,
  accountId: string,
  experimentId: string,
  payload: {
    evaluation: ExperimentEvaluation
    status: ExperimentStatus
    candidateWinnerVersionId: string | null
  }
): Promise<void> {
  const { error } = await db
    .from('ai_behavior_experiments')
    .update({
      evaluation: payload.evaluation,
      status: payload.status,
      candidate_winner_version_id: payload.candidateWinnerVersionId,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('id', experimentId)
  if (error) throw error
}

async function upsertOptimizationCursor(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db.from('ai_behavior_optimization_cursors').upsert(
    {
      account_id: accountId,
      last_run_at: new Date().toISOString(),
      analyzer_version: AI_BEHAVIOR_ANALYZER_VERSION,
    },
    { onConflict: 'account_id' }
  )
  if (error) throw error
}

function unresolved(id: string): AssignmentAttribution {
  return {
    id,
    attribution_status: 'unresolved',
    attributed_event_id: null,
    attributed_event_type: null,
  }
}
