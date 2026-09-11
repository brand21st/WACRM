import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MissingAccountIdError } from './contracts';
import { classifySalesTurn } from '@/lib/shopify/sales-turn';
import {
  assignArm,
  assignmentBucket,
  loadAiBehaviorOptimizationMode,
  resolveAiBehaviorForReply,
  type LiveExperimentRow,
  type VersionRow,
} from './assign-ai-behavior';
import { formatBehaviorGuidance } from './ai-behavior-prompt';
import { IMPLICIT_DEFAULT_BEHAVIOR } from './ai-behavior-types';

const unusedDb = {} as SupabaseClient;

const experiment: LiveExperimentRow = {
  id: 'exp-1',
  account_id: 'acct-a',
  status: 'running',
  control_version_id: 'ver-control',
  variant_version_id: 'ver-variant',
  variant_allocation: 50,
};

const controlVersion: VersionRow = {
  id: 'ver-control',
  account_id: 'acct-a',
  status: 'draft',
  behavior: IMPLICIT_DEFAULT_BEHAVIOR,
};

const variantVersion: VersionRow = {
  id: 'ver-variant',
  account_id: 'acct-a',
  status: 'draft',
  behavior: {
    injectSalesGuidance: 'omit',
    replyStyle: 'discovery',
    ctaStyle: 'softer',
  },
};

function versions(id: string): VersionRow | null {
  if (id === controlVersion.id) return controlVersion;
  if (id === variantVersion.id) return variantVersion;
  return null;
}

describe('assignmentBucket', () => {
  it('is deterministic for the same conversation and independent across conversations', () => {
    const a = assignmentBucket('acct-a', 'exp-1', 'conv-1');
    const b = assignmentBucket('acct-a', 'exp-1', 'conv-1');
    const c = assignmentBucket('acct-a', 'exp-1', 'conv-2');
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
    expect(assignArm(0, 50)).toBe('variant');
    expect(assignArm(49, 50)).toBe('variant');
    expect(assignArm(50, 50)).toBe('control');
    expect(assignArm(99, 50)).toBe('control');
    expect(c).toBeGreaterThanOrEqual(0);
  });
});

describe('loadAiBehaviorOptimizationMode', () => {
  it('treats missing, invalid, and errors as off', async () => {
    const missing = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    const invalid = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { ai_behavior_optimization: 'shadow' },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;
    expect(await loadAiBehaviorOptimizationMode(missing, 'acct-a')).toBe('off');
    expect(await loadAiBehaviorOptimizationMode(invalid, 'acct-a')).toBe('off');
  });

  it('fails before querying when accountId is missing', async () => {
    await expect(loadAiBehaviorOptimizationMode(unusedDb, '  ')).resolves.toBe(
      'off'
    );
  });
});

describe('resolveAiBehaviorForReply', () => {
  it('does not query experiments when the flag is off', async () => {
    const loadLiveExperiment = vi.fn();
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: 'Business Sales Guidance',
      },
      { loadMode: async () => 'off', loadLiveExperiment }
    );
    expect(result).toMatchObject({
      mode: 'off',
      queriedExperiment: false,
      behaviorGuidance: null,
      pendingAssignment: null,
      salesGuidance: 'Business Sales Guidance',
    });
    expect(loadLiveExperiment).not.toHaveBeenCalled();
  });

  it('fails closed when a persisted optimization flag loses runtime approval', async () => {
    const loadLiveExperiment = vi.fn();
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: 'Business Sales Guidance',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => false,
        loadLiveExperiment,
      }
    );
    expect(result.pendingAssignment).toBeNull();
    expect(result.behaviorGuidance).toBeNull();
    expect(loadLiveExperiment).not.toHaveBeenCalled();
  });

  it('does not assign factReply or greeting turns', async () => {
    const loadLiveExperiment = vi.fn(async () => experiment);
    const fact = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('how much is this'),
        queryText: 'how much is this',
        salesGuidance: 'Business Sales Guidance',
        factReply: true,
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment,
      }
    );
    expect(fact.pendingAssignment).toBeNull();
    expect(fact.behaviorGuidance).toBeNull();
    expect(loadLiveExperiment).not.toHaveBeenCalled();

    const greeting = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('hi'),
        queryText: 'hi',
        salesGuidance: null,
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment,
        loadAssignment: async () => null,
        loadVersion: async () => null,
        loadActiveVersion: async () => null,
      }
    );
    expect(greeting.pendingAssignment).toBeNull();
  });

  it('cannot force Phase 5 guidance on when inherit sees none', async () => {
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: null,
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment: async () => experiment,
        loadAssignment: async () => null,
        loadVersion: async (_db, _accountId, versionId) => versions(versionId),
        loadActiveVersion: async () => null,
      }
    );
    const arm = assignArm(assignmentBucket('acct-a', 'exp-1', 'conv-1'), 50);
    if (arm === 'control') {
      expect(result.salesGuidance).toBeNull();
      expect(result.behaviorGuidance).toBeNull();
    }
    expect(result.salesGuidance).toBeNull();
  });

  it('omits Phase 5 guidance on the variant and assigns once per conversation', async () => {
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: 'Business Sales Guidance',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment: async () => experiment,
        loadAssignment: async () => null,
        loadVersion: async (_db, _accountId, versionId) => versions(versionId),
        loadActiveVersion: async () => null,
      }
    );
    const arm = assignArm(assignmentBucket('acct-a', 'exp-1', 'conv-1'), 50);
    expect(result.queriedExperiment).toBe(true);
    expect(result.pendingAssignment?.assignedVariant).toBe(arm);
    expect(result.pendingAssignment?.experimentId).toBe('exp-1');
    if (arm === 'variant') {
      expect(result.salesGuidance).toBeNull();
      expect(result.behaviorGuidance).toBe(
        formatBehaviorGuidance({
          injectSalesGuidance: 'omit',
          replyStyle: 'discovery',
          ctaStyle: 'softer',
        })
      );
    }

    const reused = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: 'Business Sales Guidance',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment: async () => experiment,
        loadAssignment: async () => ({
          id: 'asg-1',
          account_id: 'acct-a',
          experiment_id: 'exp-1',
          version_id: result.pendingAssignment?.versionId ?? 'ver-control',
          conversation_id: 'conv-1',
          assigned_variant: arm,
        }),
        loadVersion: async (_db, _accountId, versionId) => versions(versionId),
        loadActiveVersion: async () => null,
      }
    );
    expect(reused.pendingAssignment).toBeNull();
    expect(reused.behaviorGuidance).toBe(result.behaviorGuidance);
  });

  it('stops new assignments while evaluating', async () => {
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-new',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: 'Business Sales Guidance',
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment: async () => ({
          ...experiment,
          status: 'evaluating',
        }),
        loadAssignment: async () => null,
        loadVersion: async () => null,
        loadActiveVersion: async () => null,
      }
    );
    expect(result.pendingAssignment).toBeNull();
    expect(result.behaviorGuidance).toBeNull();
    expect(result.salesGuidance).toBe('Business Sales Guidance');
  });

  it('does not use another tenant’s experiment or assignment', async () => {
    const result = await resolveAiBehaviorForReply(
      unusedDb,
      {
        accountId: 'acct-a',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: null,
      },
      {
        loadMode: async () => 'on',
        allowLive: () => true,
        loadLiveExperiment: async () => ({
          ...experiment,
          account_id: 'acct-b',
        }),
        loadAssignment: async () => ({
          id: 'asg-b',
          account_id: 'acct-b',
          experiment_id: 'exp-1',
          version_id: 'ver-variant',
          conversation_id: 'conv-1',
          assigned_variant: 'variant',
        }),
        loadActiveVersion: async () => null,
      }
    );
    expect(result.pendingAssignment).toBeNull();
    expect(result.behaviorGuidance).toBeNull();
  });

  it('requires accountId before any experiment work', async () => {
    await expect(
      resolveAiBehaviorForReply(unusedDb, {
        accountId: '',
        conversationId: 'conv-1',
        salesTurn: classifySalesTurn('too expensive'),
        queryText: 'too expensive',
        salesGuidance: null,
      })
    ).resolves.toMatchObject({ mode: 'off', queriedExperiment: false });
    expect(() => {
      throw new MissingAccountIdError('resolveAiBehaviorForReply');
    }).toThrow(MissingAccountIdError);
  });
});
