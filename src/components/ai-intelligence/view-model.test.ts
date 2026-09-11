import { describe, expect, it } from 'vitest'
import type { ExperimentRow } from './api'
import {
  CANDIDATE_COPY,
  CAUSAL_DISCLAIMER,
  NO_PATTERNS_COPY,
  PERMISSION_COPY,
  START_FLAG_OFF_COPY,
  UNAVAILABLE_COPY,
  canApprove,
  canRollback,
  canStart,
  formatImprovement,
  hasCandidate,
  observedEffectiveness,
  observedResultLabel,
  startBlockedReason,
  summarizeContext,
} from './view-model'

function experiment(
  partial: Partial<ExperimentRow> & Pick<ExperimentRow, 'status'>,
): ExperimentRow {
  return {
    id: 'e1',
    name: 'Test',
    objective: '',
    control_version_id: 'c1',
    variant_version_id: 'v1',
    control_was_implicit: true,
    variant_allocation: 50,
    started_at: null,
    ended_at: null,
    evaluation: null,
    candidate_winner_version_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('AI Intelligence view-model', () => {
  it('omits PII-like context keys', () => {
    expect(
      summarizeContext({
        customer_name: 'Ada',
        phone: '999',
        conversation_id: 'conv-1',
        category: 'Kurti',
        price_band: '3000-5000',
      }),
    ).toBe('Category: Kurti · Price band: 3000-5000')
  })

  it('reads observed effectiveness from backend only', () => {
    expect(observedEffectiveness({ observedSuccessRate: 0.65 })).toBe('65.0%')
    expect(observedEffectiveness({})).toBeNull()
  })

  it('blocks start when the optimization flag is off', () => {
    expect(startBlockedReason('off')).toBe(START_FLAG_OFF_COPY)
    expect(startBlockedReason('on')).toBeNull()
    expect(canStart('draft')).toBe(true)
    expect(canStart('running')).toBe(false)
  })

  it('approves only when backend set a candidate winner', () => {
    expect(canApprove(experiment({ status: 'evaluating' }))).toBe(false)
    expect(
      canApprove(
        experiment({
          status: 'evaluating',
          candidate_winner_version_id: 'v1',
        }),
      ),
    ).toBe(true)
    expect(
      canApprove(
        experiment({
          status: 'running',
          candidate_winner_version_id: 'v1',
        }),
      ),
    ).toBe(false)
  })

  it('allows rollback from live or approved states only', () => {
    expect(canRollback('running')).toBe(true)
    expect(canRollback('evaluating')).toBe(true)
    expect(canRollback('approved')).toBe(true)
    expect(canRollback('draft')).toBe(false)
  })

  it('labels candidate vs no-candidate without recomputing lift', () => {
    const evaluation = {
      observedImprovement: 0.072,
      control: {
        assignedCount: 1,
        eligibleOutcomeCount: 32,
        successCount: 9,
        failureCount: 23,
        unresolvedCount: 0,
        observedSuccessRate: 0.281,
        failureRate: 0.719,
      },
      variant: {
        assignedCount: 1,
        eligibleOutcomeCount: 34,
        successCount: 12,
        failureCount: 22,
        unresolvedCount: 0,
        observedSuccessRate: 0.353,
        failureRate: 0.647,
      },
    }
    expect(observedResultLabel(evaluation, null)).toBe(
      formatImprovement(0.072),
    )
    expect(observedResultLabel(evaluation, 'v1')).toBe(CANDIDATE_COPY)
    expect(hasCandidate(experiment({ status: 'running' }))).toBe(false)
    expect(CAUSAL_DISCLAIMER).toMatch(/does not establish universal causal truth/)
  })

  it('keeps operator-facing empty and permission copy', () => {
    expect(UNAVAILABLE_COPY).toBe('Sales intelligence data is not available yet.')
    expect(NO_PATTERNS_COPY).toBe('No learned sales patterns yet.')
    expect(PERMISSION_COPY).toBe(
      "You don't have permission to perform this action.",
    )
  })
})
