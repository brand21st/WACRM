import { describe, expect, it } from 'vitest';
import {
  CONTROLLED_AI_DEFAULTS,
  behaviorOptimizationGate,
  canAutoPromote,
  controlledRetrievalGate,
  effectivenessEvaluationGate,
  isControlledAiAccountApproved,
  isEnvironmentKillSwitchEnabled,
} from './controlled-ai-prerequisites';

describe('controlled AI dark gates', () => {
  it('keeps every future phase disabled by default', () => {
    expect(CONTROLLED_AI_DEFAULTS).toEqual({
      retrievalEnabled: false,
      effectivenessEnabled: false,
      optimizationEnabled: false,
      autoPromotionEnabled: false,
    });
    expect(controlledRetrievalGate()).toEqual({
      allowed: false,
      reason: 'disabled',
    });
    expect(effectivenessEvaluationGate()).toEqual({
      allowed: false,
      reason: 'disabled',
    });
    expect(behaviorOptimizationGate()).toEqual({
      allowed: false,
      reason: 'disabled',
    });
    expect(canAutoPromote()).toBe(false);
  });

  it('lets the kill switch override satisfied prerequisites', () => {
    expect(
      controlledRetrievalGate({
        enabled: true,
        killSwitch: true,
        prerequisites: [true, true],
      })
    ).toEqual({ allowed: false, reason: 'killed' });
  });

  it('requires every prerequisite explicitly', () => {
    expect(
      effectivenessEvaluationGate({
        enabled: true,
        prerequisites: [true, false],
      })
    ).toEqual({ allowed: false, reason: 'prerequisites_missing' });
    expect(
      effectivenessEvaluationGate({
        enabled: true,
        prerequisites: [true, true],
      })
    ).toEqual({ allowed: true, reason: 'ready' });
  });

  it('requires an exact account allowlist match for live controls', () => {
    expect(isControlledAiAccountApproved('acct-1', 'acct-2, acct-1')).toBe(
      true
    );
    expect(isControlledAiAccountApproved('acct-1', 'acct-10')).toBe(false);
    expect(isControlledAiAccountApproved('', 'acct-1')).toBe(false);
  });

  it('treats common explicit values as an emergency kill switch', () => {
    expect(isEnvironmentKillSwitchEnabled('true')).toBe(true);
    expect(isEnvironmentKillSwitchEnabled('ON')).toBe(true);
    expect(isEnvironmentKillSwitchEnabled('false')).toBe(false);
    expect(isEnvironmentKillSwitchEnabled(undefined)).toBe(false);
  });
});
