import { describe, expect, it } from 'vitest'
import {
  MIN_ABSOLUTE_LIFT,
  MIN_EXPERIMENT_ASSIGNMENTS,
  MIN_EXPERIMENT_ELIGIBLE_OUTCOMES_PER_ARM,
  decideExperimentOutcome,
  emptyArmMetrics,
  observedSuccessRate,
  type ArmMetrics,
} from './ai-behavior-types'

function arm(partial: Partial<ArmMetrics>): ArmMetrics {
  return { ...emptyArmMetrics(), ...partial }
}

const enough: ArmMetrics = arm({
  assignedCount: 25,
  eligibleOutcomeCount: 15,
  successCount: 6,
  failureCount: 9,
  unresolvedCount: 10,
  observedSuccessRate: 6 / 15,
  failureRate: 9 / 15,
})

describe('observedSuccessRate', () => {
  it('excludes unresolved and does not use assignedCount', () => {
    expect(observedSuccessRate(2, 2)).toBe(0.5)
    expect(observedSuccessRate(2, 0)).toBe(1)
    expect(observedSuccessRate(0, 0)).toBeNull()
  })
})

describe('decideExperimentOutcome', () => {
  const startedAt = '2026-01-01T00:00:00.000Z'
  const now = new Date('2026-01-10T00:00:00.000Z')

  it('stays running without a winner when evidence is insufficient', () => {
    const result = decideExperimentOutcome({
      control: enough,
      variant: arm({ assignedCount: 5, eligibleOutcomeCount: 2 }),
      startedAt,
      variantVersionId: 'v-var',
      now,
    })
    expect(result).toMatchObject({
      nextStatus: 'running',
      candidateWinnerVersionId: null,
      reason: 'insufficient_evidence',
    })
    expect(MIN_EXPERIMENT_ASSIGNMENTS).toBe(40)
    expect(MIN_EXPERIMENT_ELIGIBLE_OUTCOMES_PER_ARM).toBe(15)
  })

  it('requires minimum running days', () => {
    const result = decideExperimentOutcome({
      control: enough,
      variant: arm({
        assignedCount: 25,
        eligibleOutcomeCount: 15,
        successCount: 12,
        failureCount: 3,
        observedSuccessRate: 0.8,
        failureRate: 0.2,
      }),
      startedAt: '2026-01-08T00:00:00.000Z',
      variantVersionId: 'v-var',
      now,
    })
    expect(result.reason).toBe('insufficient_evidence')
    expect(result.candidateWinnerVersionId).toBeNull()
  })

  it('does not pick a winner when lift is below the threshold', () => {
    const variant = arm({
      assignedCount: 25,
      eligibleOutcomeCount: 15,
      successCount: 6,
      failureCount: 9,
      observedSuccessRate: 6 / 15,
      failureRate: 9 / 15,
    })
    const result = decideExperimentOutcome({
      control: enough,
      variant,
      startedAt,
      variantVersionId: 'v-var',
      now,
    })
    expect(variant.observedSuccessRate! - enough.observedSuccessRate!).toBeLessThan(
      MIN_ABSOLUTE_LIFT
    )
    expect(result).toMatchObject({
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      reason: 'no_observed_improvement',
    })
  })

  it('blocks a guardrail failure-rate increase', () => {
    const result = decideExperimentOutcome({
      control: enough,
      variant: arm({
        assignedCount: 25,
        eligibleOutcomeCount: 15,
        successCount: 12,
        failureCount: 3,
        observedSuccessRate: 0.8,
        failureRate: 0.85,
      }),
      startedAt,
      variantVersionId: 'v-var',
      now,
    })
    expect(result).toMatchObject({
      nextStatus: 'evaluating',
      candidateWinnerVersionId: null,
      reason: 'guardrail_failure_rate',
    })
  })

  it('names a candidate after observed improvement', () => {
    const result = decideExperimentOutcome({
      control: enough,
      variant: arm({
        assignedCount: 25,
        eligibleOutcomeCount: 15,
        successCount: 12,
        failureCount: 3,
        observedSuccessRate: 0.8,
        failureRate: 0.2,
      }),
      startedAt,
      variantVersionId: 'v-var',
      now,
    })
    expect(result).toMatchObject({
      nextStatus: 'evaluating',
      candidateWinnerVersionId: 'v-var',
      reason: 'observed_improvement',
    })
    expect(result.observedImprovement).toBeGreaterThanOrEqual(MIN_ABSOLUTE_LIFT)
  })
})
