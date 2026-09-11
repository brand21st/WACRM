/**
 * Phase 7 live-path assignment. Cheap and deterministic.
 * Records exposure only after the caller’s LLM generation succeeds.
 */

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SalesTurn } from '@/lib/shopify/sales-turn';
import { requireAccountId } from './contracts';
import {
  applySalesGuidancePolicy,
  parseAiBehaviorConfig,
} from './ai-behavior-config';
import { formatBehaviorGuidance } from './ai-behavior-prompt';
import {
  IMPLICIT_DEFAULT_BEHAVIOR,
  type AiBehaviorConfig,
  type AiBehaviorOptimizationMode,
  type AssignedVariant,
  type ExperimentStatus,
} from './ai-behavior-types';
import { shouldRetrieveSalesPatterns } from './sales-pattern-score';
import {
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from './controlled-ai-prerequisites';

export type PendingAiBehaviorAssignment = {
  accountId: string;
  experimentId: string;
  versionId: string;
  conversationId: string;
  sourceMessageId: string | null;
  assignedVariant: AssignedVariant;
  assignedAt: string;
};

export type ResolveAiBehaviorArgs = {
  accountId: string;
  conversationId: string;
  salesTurn: SalesTurn;
  queryText?: string | null;
  salesGuidance: string | null;
  sourceMessageId?: string | null;
  factReply?: boolean;
};

export type ResolveAiBehaviorResult = {
  mode: AiBehaviorOptimizationMode;
  salesGuidance: string | null;
  behaviorGuidance: string | null;
  pendingAssignment: PendingAiBehaviorAssignment | null;
  queriedExperiment: boolean;
};

export type LiveExperimentRow = {
  id: string;
  account_id: string;
  status: ExperimentStatus;
  control_version_id: string;
  variant_version_id: string;
  variant_allocation: number;
};

export type AssignmentRow = {
  id: string;
  account_id: string;
  experiment_id: string;
  version_id: string;
  conversation_id: string;
  assigned_variant: AssignedVariant;
};

export type VersionRow = {
  id: string;
  account_id: string;
  behavior: unknown;
  status: string;
};

export type ResolveAiBehaviorDeps = {
  loadMode?: typeof loadAiBehaviorOptimizationMode;
  allowLive?: (accountId: string) => boolean;
  loadLiveExperiment?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<LiveExperimentRow | null>;
  loadAssignment?: (
    db: SupabaseClient,
    accountId: string,
    experimentId: string,
    conversationId: string
  ) => Promise<AssignmentRow | null>;
  loadVersion?: (
    db: SupabaseClient,
    accountId: string,
    versionId: string
  ) => Promise<VersionRow | null>;
  loadActiveVersion?: (
    db: SupabaseClient,
    accountId: string
  ) => Promise<VersionRow | null>;
};

export async function loadAiBehaviorOptimizationMode(
  db: SupabaseClient,
  accountId: string
): Promise<AiBehaviorOptimizationMode> {
  try {
    const id = requireAccountId(accountId, 'loadAiBehaviorOptimizationMode');
    const { data, error } = await db
      .from('ai_configs')
      .select('ai_behavior_optimization')
      .eq('account_id', id)
      .maybeSingle();
    if (error || !data) return 'off';
    const mode = (data as { ai_behavior_optimization?: string })
      .ai_behavior_optimization;
    return mode === 'on' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

export function assignmentBucket(
  accountId: string,
  experimentId: string,
  conversationId: string
): number {
  const digest = createHash('sha256')
    .update(`${accountId}:${experimentId}:${conversationId}`)
    .digest();
  return digest.readUInt32BE(0) % 100;
}

export function assignArm(
  bucket: number,
  variantAllocation: number
): AssignedVariant {
  return bucket < variantAllocation ? 'variant' : 'control';
}

export function isEligibleAiBehaviorExposure(
  salesTurn: SalesTurn,
  queryText?: string | null
): boolean {
  return shouldRetrieveSalesPatterns(salesTurn, queryText);
}

export function servingFromBehavior(
  behavior: AiBehaviorConfig,
  salesGuidance: string | null
): { salesGuidance: string | null; behaviorGuidance: string | null } {
  return {
    salesGuidance: applySalesGuidancePolicy(behavior, salesGuidance),
    behaviorGuidance: formatBehaviorGuidance(behavior),
  };
}

export async function resolveAiBehaviorForReply(
  db: SupabaseClient,
  args: ResolveAiBehaviorArgs,
  deps: ResolveAiBehaviorDeps = {}
): Promise<ResolveAiBehaviorResult> {
  const passthrough = (
    mode: AiBehaviorOptimizationMode
  ): ResolveAiBehaviorResult => ({
    mode,
    salesGuidance: args.salesGuidance,
    behaviorGuidance: null,
    pendingAssignment: null,
    queriedExperiment: false,
  });

  try {
    const accountId = requireAccountId(
      args.accountId,
      'resolveAiBehaviorForReply'
    );
    const conversationId = args.conversationId.trim();
    if (!conversationId) return passthrough('off');

    const loadMode = deps.loadMode ?? loadAiBehaviorOptimizationMode;
    const mode = await loadMode(db, accountId);
    if (mode !== 'on') return passthrough(mode);
    const allowLive =
      deps.allowLive ??
      ((id: string) =>
        isControlledAiAccountApproved(id) &&
        !isEnvironmentKillSwitchEnabled(
          process.env.AI_INTELLIGENCE_KILL_OPTIMIZATION
        ));
    if (!allowLive(accountId)) return passthrough(mode);
    if (args.factReply) return { ...passthrough(mode) };

    const loadLive = deps.loadLiveExperiment ?? loadLiveExperiment;
    const experiment = await loadLive(db, accountId);
    const loadActive = deps.loadActiveVersion ?? loadActiveVersion;
    const loadVersion = deps.loadVersion ?? defaultLoadVersion;

    if (!experiment || experiment.account_id !== accountId) {
      const active = await loadActive(db, accountId);
      return applyVersion(mode, args.salesGuidance, active, true);
    }

    const loadAssignment = deps.loadAssignment ?? defaultLoadAssignment;
    const existing = await loadAssignment(
      db,
      accountId,
      experiment.id,
      conversationId
    );
    if (existing && existing.account_id === accountId) {
      const version = await loadVersion(db, accountId, existing.version_id);
      return applyVersion(mode, args.salesGuidance, version, true);
    }

    if (experiment.status === 'evaluating') {
      const active = await loadActive(db, accountId);
      return applyVersion(mode, args.salesGuidance, active, true);
    }

    if (!isEligibleAiBehaviorExposure(args.salesTurn, args.queryText)) {
      const active = await loadActive(db, accountId);
      return applyVersion(mode, args.salesGuidance, active, true);
    }

    const arm = assignArm(
      assignmentBucket(accountId, experiment.id, conversationId),
      experiment.variant_allocation
    );
    const versionId =
      arm === 'variant'
        ? experiment.variant_version_id
        : experiment.control_version_id;
    const version = await loadVersion(db, accountId, versionId);
    const applied = applyVersion(mode, args.salesGuidance, version, true);
    return {
      ...applied,
      pendingAssignment: {
        accountId,
        experimentId: experiment.id,
        versionId,
        conversationId,
        sourceMessageId: args.sourceMessageId?.trim() || null,
        assignedVariant: arm,
        assignedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    console.warn('[ai-behavior] resolve failed', { accountId: args.accountId });
    void err;
    return passthrough('off');
  }
}

export async function recordAiBehaviorAssignment(
  db: SupabaseClient,
  pending: PendingAiBehaviorAssignment
): Promise<boolean> {
  try {
    const accountId = requireAccountId(
      pending.accountId,
      'recordAiBehaviorAssignment'
    );
    const { error } = await db.from('ai_behavior_assignments').upsert(
      {
        account_id: accountId,
        experiment_id: pending.experimentId,
        version_id: pending.versionId,
        conversation_id: pending.conversationId,
        source_message_id: pending.sourceMessageId,
        assigned_variant: pending.assignedVariant,
        assigned_at: pending.assignedAt,
        attribution_status: 'unresolved',
      },
      {
        onConflict: 'account_id,experiment_id,conversation_id',
        ignoreDuplicates: true,
      }
    );
    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[ai-behavior] assignment record failed', {
      accountId: pending.accountId,
    });
    void err;
    return false;
  }
}

function applyVersion(
  mode: AiBehaviorOptimizationMode,
  salesGuidance: string | null,
  version: VersionRow | null,
  queriedExperiment: boolean
): ResolveAiBehaviorResult {
  const behavior = version
    ? parseAiBehaviorConfig(version.behavior)
    : IMPLICIT_DEFAULT_BEHAVIOR;
  const served = servingFromBehavior(behavior, salesGuidance);
  return {
    mode,
    salesGuidance: served.salesGuidance,
    behaviorGuidance: served.behaviorGuidance,
    pendingAssignment: null,
    queriedExperiment,
  };
}

async function loadLiveExperiment(
  db: SupabaseClient,
  accountId: string
): Promise<LiveExperimentRow | null> {
  const { data, error } = await db
    .from('ai_behavior_experiments')
    .select(
      'id, account_id, status, control_version_id, variant_version_id, variant_allocation'
    )
    .eq('account_id', accountId)
    .in('status', ['running', 'evaluating'])
    .maybeSingle();
  if (error) throw error;
  return (data as LiveExperimentRow | null) ?? null;
}

async function defaultLoadAssignment(
  db: SupabaseClient,
  accountId: string,
  experimentId: string,
  conversationId: string
): Promise<AssignmentRow | null> {
  const { data, error } = await db
    .from('ai_behavior_assignments')
    .select(
      'id, account_id, experiment_id, version_id, conversation_id, assigned_variant'
    )
    .eq('account_id', accountId)
    .eq('experiment_id', experimentId)
    .eq('conversation_id', conversationId)
    .maybeSingle();
  if (error) throw error;
  return (data as AssignmentRow | null) ?? null;
}

async function defaultLoadVersion(
  db: SupabaseClient,
  accountId: string,
  versionId: string
): Promise<VersionRow | null> {
  const { data, error } = await db
    .from('ai_behavior_versions')
    .select('id, account_id, behavior, status')
    .eq('account_id', accountId)
    .eq('id', versionId)
    .maybeSingle();
  if (error) throw error;
  return (data as VersionRow | null) ?? null;
}

async function loadActiveVersion(
  db: SupabaseClient,
  accountId: string
): Promise<VersionRow | null> {
  const { data, error } = await db
    .from('ai_behavior_versions')
    .select('id, account_id, behavior, status')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .maybeSingle();
  if (error) throw error;
  return (data as VersionRow | null) ?? null;
}
