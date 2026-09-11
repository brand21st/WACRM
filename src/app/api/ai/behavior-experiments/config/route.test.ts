import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadAiBehaviorOptimizationMode: vi.fn(),
  loadExperimentConfigExtras: vi.fn(),
  setAiBehaviorOptimizationMode: vi.fn(),
  isControlledAiAccountApproved: vi.fn(() => false),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

vi.mock('@/lib/ai/intelligence/assign-ai-behavior', () => ({
  loadAiBehaviorOptimizationMode: mocks.loadAiBehaviorOptimizationMode,
}));

vi.mock('@/lib/ai/intelligence/ai-behavior-admin', () => ({
  setAiBehaviorOptimizationMode: mocks.setAiBehaviorOptimizationMode,
}));

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  loadExperimentConfigExtras: mocks.loadExperimentConfigExtras,
}));

vi.mock('@/lib/ai/intelligence/controlled-ai-prerequisites', () => ({
  isControlledAiAccountApproved: mocks.isControlledAiAccountApproved,
}));

import { ForbiddenError } from '@/lib/auth/account';
import { GET, PATCH } from './route';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.loadAiBehaviorOptimizationMode.mockReset();
  mocks.loadExperimentConfigExtras.mockReset();
  mocks.setAiBehaviorOptimizationMode.mockReset();
});

describe('PATCH /api/ai/behavior-experiments/config', () => {
  it('blocks optimization without account approval and confirmation', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await PATCH(
      new Request('http://localhost/api/ai/behavior-experiments/config', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      })
    );
    expect(response.status).toBe(409);
    expect(mocks.setAiBehaviorOptimizationMode).not.toHaveBeenCalled();
  });
});

describe('GET /api/ai/behavior-experiments/config', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError());
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('includes active behavior and live experiment extras', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' });
    mocks.loadAiBehaviorOptimizationMode.mockResolvedValue('off');
    mocks.loadExperimentConfigExtras.mockResolvedValue({
      active_behavior: {
        version: 2,
        behavior: {
          injectSalesGuidance: 'inherit',
          replyStyle: 'default',
          ctaStyle: 'default',
        },
      },
      live_experiment: null,
    });
    const res = await GET();
    const body = await res.json();
    expect(body.ai_behavior_optimization).toBe('off');
    expect(body.active_behavior.version).toBe(2);
    expect(body.live_experiment).toBeNull();
    expect(mocks.loadExperimentConfigExtras).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1'
    );
  });
});
