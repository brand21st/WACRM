import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn().mockResolvedValue({
    accountId: 'acct-a',
    userId: 'user-a',
  }),
  start: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({}, { status: 429 }),
  RATE_LIMITS: { adminAction: {} },
}));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({}) }));
vi.mock('@/lib/ai/intelligence/ai-behavior-admin', () => ({
  AiBehaviorAdminError: class extends Error {
    status = 400;
  },
  startAiBehaviorExperiment: mocks.start,
}));
vi.mock('@/lib/ai/intelligence/controlled-ai-prerequisites', () => ({
  isControlledAiAccountApproved: () => false,
  isEnvironmentKillSwitchEnabled: () => false,
}));

import { POST } from './route';

describe('POST experiment start', () => {
  it('fails closed before mutating an unapproved account', async () => {
    const response = await POST(
      new Request('http://localhost/start', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'START CONTROLLED EXPERIMENT' }),
      }),
      { params: Promise.resolve({ id: 'experiment-a' }) }
    );
    expect(response.status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
