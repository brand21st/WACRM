import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  loadMerchantLearningSummary: vi.fn(),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}));

vi.mock('@/lib/ai/intelligence/learning-summary', () => ({
  loadMerchantLearningSummary: mocks.loadMerchantLearningSummary,
}));

import { UnauthorizedError } from '@/lib/auth/account';
import { GET } from './route';

const safeSummary = {
  available: false,
  status: 'not_installed',
  window_days: 7,
  metrics: {
    conversations: 94,
    analyzed: 0,
    analyzed_today: 0,
    waiting: 94,
    new_sales_events: 0,
    insight_count: 0,
    emerging_pattern_count: 0,
    strong_pattern_count: 0,
    recommendation_signal_count: null,
    customer_trend_count: 0,
    last_analyzed_at: null,
  },
  insights: [],
  empty_state:
    'Background learning is not installed on this database yet. 94 conversations are waiting. Deterministic analysis will not change customer replies.',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/ai/intelligence/learning-summary', () => {
  it('requires authentication', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError());
    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(mocks.loadMerchantLearningSummary).not.toHaveBeenCalled();
  });

  it('uses only the authenticated admin account', async () => {
    const adminDb = { name: 'service-db' };
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-authenticated',
      userId: 'user-1',
    });
    mocks.supabaseAdmin.mockReturnValue(adminDb);
    mocks.loadMerchantLearningSummary.mockResolvedValue(safeSummary);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.loadMerchantLearningSummary).toHaveBeenCalledWith(
      adminDb,
      'acct-authenticated'
    );
    await expect(response.json()).resolves.toEqual(safeSummary);
  });

  it('returns the safe missing-schema result without leaking internals', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
    });
    mocks.supabaseAdmin.mockReturnValue({});
    mocks.loadMerchantLearningSummary.mockResolvedValue(safeSummary);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(safeSummary);
    expect(JSON.stringify(body)).not.toMatch(/sql|supabase|postgres|relation/i);
  });
});
