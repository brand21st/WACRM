/**
 * Admin mutations for Phase 7. Service-role writes, always account-scoped.
 * Never auto-starts, auto-promotes, or auto-rollbacks.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { requireAccountId } from './contracts'
import {
  IMPLICIT_DEFAULT_BEHAVIOR,
  type AiBehaviorConfig,
  type AiBehaviorOptimizationMode,
  type ExperimentStatus,
} from './ai-behavior-types'
import { parseAiBehaviorConfig } from './ai-behavior-config'
import { loadAiBehaviorOptimizationMode } from './assign-ai-behavior'

export class AiBehaviorAdminError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'AiBehaviorAdminError'
    this.status = status
  }
}

export async function setAiBehaviorOptimizationMode(
  db: SupabaseClient,
  accountId: string,
  mode: AiBehaviorOptimizationMode
): Promise<AiBehaviorOptimizationMode> {
  const id = requireAccountId(accountId, 'setAiBehaviorOptimizationMode')
  const next = mode === 'on' ? 'on' : 'off'
  const { error } = await db
    .from('ai_configs')
    .update({ ai_behavior_optimization: next })
    .eq('account_id', id)
  if (error) throw error
  return next
}

export async function createAiBehaviorExperiment(
  db: SupabaseClient,
  args: {
    accountId: string
    name: string
    objective?: string
    variantBehavior: unknown
    variantAllocation?: number
    createdBy?: string | null
  }
): Promise<{ experimentId: string; controlVersionId: string; variantVersionId: string }> {
  const accountId = requireAccountId(args.accountId, 'createAiBehaviorExperiment')
  const name = args.name.trim()
  if (!name) throw new AiBehaviorAdminError('name is required')
  const allocation = args.variantAllocation ?? 50
  if (!Number.isInteger(allocation) || allocation < 1 || allocation > 99) {
    throw new AiBehaviorAdminError('variant_allocation must be an integer 1–99')
  }
  const variantBehavior = parseAiBehaviorConfig(args.variantBehavior)

  const live = await loadLiveExperimentId(db, accountId)
  if (live) {
    throw new AiBehaviorAdminError(
      'an experiment is already running or evaluating',
      409
    )
  }

  const active = await loadActiveVersion(db, accountId)
  const nextVersion = await nextVersionNumber(db, accountId)
  const controlWasImplicit = !active
  const control = active
    ? { id: active.id }
    : await insertVersion(db, {
        accountId,
        version: nextVersion,
        behavior: IMPLICIT_DEFAULT_BEHAVIOR,
        status: 'draft',
        createdBy: args.createdBy ?? null,
      })
  const variant = await insertVersion(db, {
    accountId,
    version: active ? nextVersion : nextVersion + 1,
    behavior: variantBehavior,
    status: 'draft',
    createdBy: args.createdBy ?? null,
  })

  const { data, error } = await db
    .from('ai_behavior_experiments')
    .insert({
      account_id: accountId,
      name,
      objective: (args.objective ?? '').trim(),
      control_version_id: control.id,
      variant_version_id: variant.id,
      control_was_implicit: controlWasImplicit,
      variant_allocation: allocation,
      status: 'draft',
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new AiBehaviorAdminError('failed to create experiment', 500)
  }
  return {
    experimentId: (data as { id: string }).id,
    controlVersionId: control.id,
    variantVersionId: variant.id,
  }
}

export async function startAiBehaviorExperiment(
  db: SupabaseClient,
  accountId: string,
  experimentId: string
): Promise<void> {
  const id = requireAccountId(accountId, 'startAiBehaviorExperiment')
  const mode = await loadAiBehaviorOptimizationMode(db, id)
  if (mode !== 'on') {
    throw new AiBehaviorAdminError('ai_behavior_optimization must be on', 409)
  }
  const experiment = await loadExperiment(db, id, experimentId)
  if (!experiment) throw new AiBehaviorAdminError('experiment not found', 404)
  if (experiment.status !== 'draft') {
    throw new AiBehaviorAdminError('experiment must be draft to start')
  }
  const live = await loadLiveExperimentId(db, id)
  if (live && live !== experimentId) {
    throw new AiBehaviorAdminError(
      'an experiment is already running or evaluating',
      409
    )
  }
  const { error } = await db
    .from('ai_behavior_experiments')
    .update({
      status: 'running',
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', id)
    .eq('id', experimentId)
    .eq('status', 'draft')
  if (error) throw error
}

export async function approveAiBehaviorExperiment(
  db: SupabaseClient,
  accountId: string,
  experimentId: string
): Promise<void> {
  const id = requireAccountId(accountId, 'approveAiBehaviorExperiment')
  const mode = await loadAiBehaviorOptimizationMode(db, id)
  if (mode !== 'on') {
    throw new AiBehaviorAdminError('ai_behavior_optimization must be on', 409)
  }
  const experiment = await loadExperiment(db, id, experimentId)
  if (!experiment) throw new AiBehaviorAdminError('experiment not found', 404)
  if (experiment.status !== 'evaluating') {
    throw new AiBehaviorAdminError('experiment must be evaluating to approve')
  }
  const winnerId = experiment.candidate_winner_version_id
  if (!winnerId) {
    throw new AiBehaviorAdminError('no candidate winner')
  }
  await activateExactVersion(db, id, winnerId)
  const { error } = await db
    .from('ai_behavior_experiments')
    .update({
      status: 'approved',
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', id)
    .eq('id', experimentId)
    .eq('status', 'evaluating')
  if (error) throw error
}

export async function rollbackAiBehaviorExperiment(
  db: SupabaseClient,
  accountId: string,
  experimentId: string
): Promise<void> {
  const id = requireAccountId(accountId, 'rollbackAiBehaviorExperiment')
  const experiment = await loadExperiment(db, id, experimentId)
  if (!experiment) throw new AiBehaviorAdminError('experiment not found', 404)
  if (
    experiment.status !== 'running' &&
    experiment.status !== 'evaluating' &&
    experiment.status !== 'approved'
  ) {
    throw new AiBehaviorAdminError('experiment cannot be rolled back')
  }

  if (experiment.control_was_implicit) {
    await clearActiveVersion(db, id)
  } else {
    await activateExactVersion(db, id, experiment.control_version_id)
  }

  const { error } = await db
    .from('ai_behavior_experiments')
    .update({
      status: 'rolled_back',
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', id)
    .eq('id', experimentId)
  if (error) throw error
}

async function activateExactVersion(
  db: SupabaseClient,
  accountId: string,
  versionId: string
): Promise<void> {
  const { data: target, error: loadErr } = await db
    .from('ai_behavior_versions')
    .select('id, account_id')
    .eq('account_id', accountId)
    .eq('id', versionId)
    .maybeSingle()
  if (loadErr) throw loadErr
  if (!target) throw new AiBehaviorAdminError('version not found', 404)

  const { error: archiveErr } = await db
    .from('ai_behavior_versions')
    .update({ status: 'archived' })
    .eq('account_id', accountId)
    .eq('status', 'active')
    .neq('id', versionId)
  if (archiveErr) throw archiveErr

  const { error: activateErr } = await db
    .from('ai_behavior_versions')
    .update({ status: 'active' })
    .eq('account_id', accountId)
    .eq('id', versionId)
  if (activateErr) throw activateErr
}

async function clearActiveVersion(
  db: SupabaseClient,
  accountId: string
): Promise<void> {
  const { error } = await db
    .from('ai_behavior_versions')
    .update({ status: 'archived' })
    .eq('account_id', accountId)
    .eq('status', 'active')
  if (error) throw error
}

async function insertVersion(
  db: SupabaseClient,
  args: {
    accountId: string
    version: number
    behavior: AiBehaviorConfig
    status: 'draft' | 'active' | 'archived'
    createdBy: string | null
  }
): Promise<{ id: string }> {
  const { data, error } = await db
    .from('ai_behavior_versions')
    .insert({
      account_id: args.accountId,
      version: args.version,
      behavior: args.behavior,
      status: args.status,
      created_by: args.createdBy,
    })
    .select('id')
    .single()
  if (error || !data) throw new AiBehaviorAdminError('failed to create version', 500)
  return data as { id: string }
}

async function nextVersionNumber(
  db: SupabaseClient,
  accountId: string
): Promise<number> {
  const { data, error } = await db
    .from('ai_behavior_versions')
    .select('version')
    .eq('account_id', accountId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  const current = (data as { version?: number } | null)?.version
  return (current ?? 0) + 1
}

async function loadActiveVersion(
  db: SupabaseClient,
  accountId: string
): Promise<{ id: string; behavior: unknown } | null> {
  const { data, error } = await db
    .from('ai_behavior_versions')
    .select('id, behavior')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  return (data as { id: string; behavior: unknown } | null) ?? null
}

async function loadLiveExperimentId(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select('id')
    .eq('account_id', accountId)
    .in('status', ['running', 'evaluating'])
    .maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}

async function loadExperiment(
  db: SupabaseClient,
  accountId: string,
  experimentId: string
): Promise<{
  id: string
  status: ExperimentStatus
  control_version_id: string
  control_was_implicit: boolean
  candidate_winner_version_id: string | null
} | null> {
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select(
      'id, status, control_version_id, control_was_implicit, candidate_winner_version_id'
    )
    .eq('account_id', accountId)
    .eq('id', experimentId)
    .maybeSingle()
  if (error) throw error
  return data as {
    id: string
    status: ExperimentStatus
    control_version_id: string
    control_was_implicit: boolean
    candidate_winner_version_id: string | null
  } | null
}
