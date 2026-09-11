import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MissingAccountIdError } from './contracts'
import {
  attributeAssignment,
  evaluateAccountAiBehaviorExperiments,
  rollupArmMetrics,
  type AssignmentEvalRow,
  type TerminalSalesEventRow,
} from './evaluate-ai-behavior-experiments'

const unusedDb = {} as SupabaseClient

function assignment(
  partial: Partial<AssignmentEvalRow> & Pick<AssignmentEvalRow, 'id'>
): AssignmentEvalRow {
  return {
    account_id: 'acct-a',
    experiment_id: 'exp-1',
    conversation_id: 'conv-1',
    assigned_variant: 'control',
    assigned_at: '2026-09-01T00:00:00.000Z',
    attribution_status: 'unresolved',
    attributed_event_id: null,
    attributed_event_type: null,
    ...partial,
  }
}

function event(
  partial: Partial<TerminalSalesEventRow> & Pick<TerminalSalesEventRow, 'id' | 'event_type'>
): TerminalSalesEventRow {
  return {
    account_id: 'acct-a',
    conversation_id: 'conv-1',
    kind: 'outcome',
    created_at: '2026-09-01T12:00:00.000Z',
    ...partial,
  }
}

describe('attributeAssignment', () => {
  const assigned = assignment({ id: 'a-1' })

  it('uses the latest terminal outcome after assignment within 7 days', () => {
    const result = attributeAssignment(assigned, [
      event({
        id: 'e-abandon',
        event_type: 'CHECKOUT_ABANDONED',
        created_at: '2026-09-01T06:00:00.000Z',
      }),
      event({
        id: 'e-order',
        event_type: 'ORDER_CREATED',
        created_at: '2026-09-02T00:00:00.000Z',
      }),
    ])
    expect(result.attribution_status).toBe('success')
    expect(result.attributed_event_id).toBe('e-order')
  })

  it('treats later cancellation as failure and payment as success', () => {
    expect(
      attributeAssignment(assigned, [
        event({ id: 'e-paid', event_type: 'PAYMENT_COMPLETED' }),
      ]).attribution_status
    ).toBe('success')
    expect(
      attributeAssignment(assigned, [
        event({
          id: 'e-paid',
          event_type: 'PAYMENT_COMPLETED',
          created_at: '2026-09-01T06:00:00.000Z',
        }),
        event({
          id: 'e-cancel',
          event_type: 'ORDER_CANCELLED',
          created_at: '2026-09-02T00:00:00.000Z',
        }),
      ]).attribution_status
    ).toBe('failure')
    expect(
      attributeAssignment(assigned, [
        event({ id: 'e-cancel', event_type: 'ORDER_CANCELLED' }),
      ]).attribution_status
    ).toBe('failure')
    expect(
      attributeAssignment(assigned, [
        event({ id: 'e-abandon', event_type: 'CHECKOUT_ABANDONED' }),
      ]).attribution_status
    ).toBe('failure')
  })

  it('ignores outcomes before assignment, after 7 days, and funnel-only signals', () => {
    expect(
      attributeAssignment(assigned, [
        event({
          id: 'e-early',
          event_type: 'ORDER_CREATED',
          created_at: '2026-08-31T00:00:00.000Z',
        }),
      ]).attribution_status
    ).toBe('unresolved')
    expect(
      attributeAssignment(assigned, [
        event({
          id: 'e-late',
          event_type: 'ORDER_CREATED',
          created_at: '2026-09-10T00:00:00.000Z',
        }),
      ]).attribution_status
    ).toBe('unresolved')
    expect(
      attributeAssignment(assigned, [
        event({ id: 'e-cart', event_type: 'CART_CREATED' }),
        event({
          id: 'e-start',
          event_type: 'CHECKOUT_STARTED',
        }),
        event({
          id: 'e-intent',
          event_type: 'PURCHASE_INTENT',
          kind: 'signal',
        }),
      ]).attribution_status
    ).toBe('unresolved')
  })

  it('does not attribute another tenant’s outcome', () => {
    expect(
      attributeAssignment(assigned, [
        event({
          id: 'e-b',
          event_type: 'ORDER_CREATED',
          account_id: 'acct-b',
        }),
      ]).attribution_status
    ).toBe('unresolved')
  })
})

describe('rollupArmMetrics', () => {
  it('excludes unresolved from the observed success rate', () => {
    const { control } = rollupArmMetrics([
      {
        ...assignment({ id: 'a-1', assigned_variant: 'control' }),
        attribution_status: 'success',
        attributed_event_id: 'e-1',
        attributed_event_type: 'ORDER_CREATED',
      },
      {
        ...assignment({
          id: 'a-2',
          assigned_variant: 'control',
          conversation_id: 'conv-2',
        }),
        attribution_status: 'failure',
        attributed_event_id: 'e-2',
        attributed_event_type: 'CHECKOUT_ABANDONED',
      },
      {
        ...assignment({
          id: 'a-3',
          assigned_variant: 'control',
          conversation_id: 'conv-3',
        }),
        attribution_status: 'unresolved',
        attributed_event_id: null,
        attributed_event_type: null,
      },
    ])
    expect(control).toMatchObject({
      assignedCount: 3,
      eligibleOutcomeCount: 2,
      successCount: 1,
      failureCount: 1,
      unresolvedCount: 1,
      observedSuccessRate: 0.5,
    })
  })
})

describe('evaluateAccountAiBehaviorExperiments', () => {
  it('requires accountId and is idempotent for the same evidence', async () => {
    await expect(
      evaluateAccountAiBehaviorExperiments(unusedDb, '')
    ).rejects.toBeInstanceOf(MissingAccountIdError)

    const experiments = [
      {
        id: 'exp-1',
        account_id: 'acct-a',
        status: 'running' as const,
        started_at: '2026-01-01T00:00:00.000Z',
        variant_version_id: 'ver-var',
      },
    ]
    const assignments = [
      assignment({ id: 'a-1', assigned_variant: 'control' }),
      assignment({
        id: 'a-2',
        assigned_variant: 'variant',
        conversation_id: 'conv-2',
      }),
    ]
    const events = [
      event({
        id: 'e-1',
        event_type: 'ORDER_CREATED',
        conversation_id: 'conv-1',
      }),
      event({
        id: 'e-2',
        event_type: 'CHECKOUT_ABANDONED',
        conversation_id: 'conv-2',
      }),
    ]
    const writes: unknown[] = []
    const deps = {
      loadLiveExperiments: async () => experiments,
      loadAssignments: async () => assignments,
      loadTerminalEvents: async () => events,
      writeAttributions: async () => undefined,
      writeEvaluation: async (
        _db: SupabaseClient,
        accountId: string,
        experimentId: string,
        payload: unknown
      ) => {
        writes.push({ accountId, experimentId, payload })
      },
      upsertCursor: async () => undefined,
    }
    const first = await evaluateAccountAiBehaviorExperiments(
      unusedDb,
      'acct-a',
      deps
    )
    const second = await evaluateAccountAiBehaviorExperiments(
      unusedDb,
      'acct-a',
      deps
    )
    expect(first).toEqual(second)
    expect(writes).toHaveLength(2)
    expect(writes[0]).toEqual(writes[1])
    expect(writes[0]).toMatchObject({ accountId: 'acct-a', experimentId: 'exp-1' })
  })
})
