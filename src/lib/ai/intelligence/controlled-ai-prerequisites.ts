/**
 * Dark infrastructure for future controlled AI phases.
 *
 * These helpers are deliberately pure and fail closed. They do not read or
 * write flags, start experiments, promote candidates, or alter serving.
 */

export const CONTROLLED_AI_DEFAULTS = Object.freeze({
  retrievalEnabled: false,
  effectivenessEnabled: false,
  optimizationEnabled: false,
  autoPromotionEnabled: false,
});

export type ControlledAiGateInput = {
  enabled?: boolean;
  killSwitch?: boolean;
  prerequisites?: readonly boolean[];
};

export type ControlledAiGate = {
  allowed: boolean;
  reason: 'disabled' | 'killed' | 'prerequisites_missing' | 'ready';
};

export function evaluateControlledAiGate(
  input: ControlledAiGateInput = {}
): ControlledAiGate {
  if (input.killSwitch === true) return { allowed: false, reason: 'killed' };
  if (input.enabled !== true) return { allowed: false, reason: 'disabled' };
  if (!(input.prerequisites ?? []).every((value) => value === true)) {
    return { allowed: false, reason: 'prerequisites_missing' };
  }
  return { allowed: true, reason: 'ready' };
}

export const controlledRetrievalGate = evaluateControlledAiGate;
export const effectivenessEvaluationGate = evaluateControlledAiGate;
export const behaviorOptimizationGate = evaluateControlledAiGate;

export function canAutoPromote(): false {
  return CONTROLLED_AI_DEFAULTS.autoPromotionEnabled;
}

export function isControlledAiAccountApproved(
  accountId: string,
  rawAllowlist: string | undefined = process.env
    .AI_INTELLIGENCE_LIVE_APPROVED_ACCOUNTS
): boolean {
  const id = accountId.trim();
  if (!id || !rawAllowlist) return false;
  return rawAllowlist
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(id);
}

export function isEnvironmentKillSwitchEnabled(
  rawValue: string | undefined
): boolean {
  return ['1', 'true', 'on', 'yes'].includes(
    (rawValue ?? '').trim().toLowerCase()
  );
}
