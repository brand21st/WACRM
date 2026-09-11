import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadSalesPatternRetrievalMode: vi.fn(),
  setSalesPatternRetrievalMode: vi.fn(),
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

vi.mock('@/lib/ai/intelligence/retrieve-sales-patterns', () => ({
  loadSalesPatternRetrievalMode: mocks.loadSalesPatternRetrievalMode,
}));

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  setSalesPatternRetrievalMode: mocks.setSalesPatternRetrievalMode,
}));

vi.mock('@/lib/ai/intelligence/controlled-ai-prerequisites', () => ({
  isControlledAiAccountApproved: mocks.isControlledAiAccountApproved,
}));

import { ForbiddenError } from '@/lib/auth/account';
import { GET, PATCH } from './route';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.loadSalesPatternRetrievalMode.mockReset();
  mocks.setSalesPatternRetrievalMode.mockReset();
});

describe('/api/ai/patterns/config', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError());
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('rejects invalid retrieval modes', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' });
    const res = await PATCH(
      new Request('http://localhost/api/ai/patterns/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_pattern_retrieval: 'force_on' }),
      })
    );
    expect(res.status).toBe(400);
    expect(mocks.setSalesPatternRetrievalMode).not.toHaveBeenCalled();
  });

  it('saves an allowlisted mode for this account only', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' });
    mocks.setSalesPatternRetrievalMode.mockResolvedValue('shadow');
    const res = await PATCH(
      new Request('http://localhost/api/ai/patterns/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_pattern_retrieval: 'shadow' }),
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sales_pattern_retrieval: 'shadow' });
    expect(mocks.setSalesPatternRetrievalMode).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
      'shadow'
    );
  });

  it('blocks live retrieval without a deployment allowlist and confirmation', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' });
    const res = await PATCH(
      new Request('http://localhost/api/ai/patterns/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sales_pattern_retrieval: 'on' }),
      })
    );
    expect(res.status).toBe(409);
    expect(mocks.setSalesPatternRetrievalMode).not.toHaveBeenCalled();
  });
});
