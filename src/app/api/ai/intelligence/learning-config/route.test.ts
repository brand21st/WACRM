import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  checkRateLimit: vi.fn(() => ({ success: true })),
}));

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>();
  return { ...actual, requireRole: mocks.requireRole };
});

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
  rateLimitResponse: () =>
    Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}));

import { GET, PATCH } from './route';

function configDb(options?: {
  readError?: { code: string; message: string };
  writeError?: { code: string; message: string };
}) {
  const eq = vi.fn();
  const update = vi.fn();
  const row = {
    background_learning_mode: 'deterministic',
    background_learning_paused: false,
    background_learning_daily_conversation_limit: 100,
    background_learning_daily_token_limit: 25_000,
    recommendation_intelligence: 'off',
  };
  const query = {
    select: () => query,
    eq: (...args: unknown[]) => {
      eq(...args);
      return query;
    },
    maybeSingle: async () =>
      options?.readError
        ? { data: null, error: options.readError }
        : { data: row, error: null },
    update: (value: unknown) => {
      update(value);
      return query;
    },
    single: async () =>
      options?.writeError
        ? { data: null, error: options.writeError }
        : { data: row, error: null },
  };
  return {
    client: { from: () => query },
    eq,
    update,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/api/ai/intelligence/learning-config', () => {
  it('reads only the authenticated admin account', async () => {
    const db = configDb();
    mocks.requireRole.mockResolvedValue({
      supabase: db.client,
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(db.eq).toHaveBeenCalledWith('account_id', 'acct-1');
  });

  it('requires explicit cost approval for hybrid learning', async () => {
    const db = configDb();
    mocks.requireRole.mockResolvedValue({
      supabase: db.client,
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await PATCH(
      new Request('http://localhost/api/ai/intelligence/learning-config', {
        method: 'PATCH',
        body: JSON.stringify({ background_learning_mode: 'hybrid' }),
      })
    );
    expect(response.status).toBe(409);
    expect(db.update).not.toHaveBeenCalled();
  });

  it('updates deterministic learning without accepting an account id', async () => {
    const db = configDb();
    mocks.requireRole.mockResolvedValue({
      supabase: db.client,
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await PATCH(
      new Request('http://localhost/api/ai/intelligence/learning-config', {
        method: 'PATCH',
        body: JSON.stringify({
          accountId: 'foreign',
          background_learning_mode: 'deterministic',
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledWith({
      background_learning_mode: 'deterministic',
    });
    expect(db.eq).toHaveBeenCalledWith('account_id', 'acct-1');
  });

  it('returns safe off defaults when learning columns are missing', async () => {
    const db = configDb({
      readError: {
        code: '42703',
        message: 'column background_learning_mode does not exist',
      },
    });
    mocks.requireRole.mockResolvedValue({
      supabase: db.client,
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      background_learning_mode: 'off',
      background_learning_paused: false,
      background_learning_daily_conversation_limit: 100,
      background_learning_daily_token_limit: 25_000,
      recommendation_intelligence: 'off',
      available: false,
    });
  });

  it('does not write when learning columns are missing', async () => {
    const db = configDb({
      writeError: {
        code: 'PGRST204',
        message: "Could not find the 'recommendation_intelligence' column",
      },
    });
    mocks.requireRole.mockResolvedValue({
      supabase: db.client,
      accountId: 'acct-1',
      userId: 'user-1',
    });
    const response = await PATCH(
      new Request('http://localhost/api/ai/intelligence/learning-config', {
        method: 'PATCH',
        body: JSON.stringify({ background_learning_mode: 'deterministic' }),
      })
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Learning controls are not available yet',
    });
    expect(db.update).toHaveBeenCalled();
  });
});
