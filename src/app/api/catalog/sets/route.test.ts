import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listCollectionsByAccount: vi.fn(),
  upsertCollection: vi.fn(),
  buildCatalogSetDraft: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@/lib/catalog/core/commands', () => ({
  upsertCollection: mocks.upsertCollection,
}))

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>()
  return {
    ...actual,
    listCollectionsByAccount: mocks.listCollectionsByAccount,
    upsertCollection: mocks.upsertCollection,
    buildCatalogSetDraft: mocks.buildCatalogSetDraft,
  }
})

import { GET, POST } from './route'

const set = {
  id: 'col-1',
  accountId: 'acct-1',
  handle: 'sarees',
  title: 'Sarees',
  status: 'active' as const,
  productCount: 1,
  productIds: ['prod-1'],
  metaProductSetId: 'ps-1',
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.listCollectionsByAccount.mockReset()
  mocks.upsertCollection.mockReset()
  mocks.buildCatalogSetDraft.mockReset()
})

describe('GET /api/catalog/sets', () => {
  it('lists sets for the current account', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
    })
    mocks.listCollectionsByAccount.mockResolvedValue([set])
    const res = await GET()
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sets: [
        expect.objectContaining({
          id: 'col-1',
          title: 'Sarees',
          metaSynced: true,
          productCount: 1,
        }),
      ],
    })
  })
})

describe('POST /api/catalog/sets', () => {
  it('creates a set', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.buildCatalogSetDraft.mockResolvedValue({
      accountId: 'acct-1',
      handle: 'sarees',
      title: 'Sarees',
      productIds: [],
    })
    mocks.upsertCollection.mockResolvedValue(set)
    const res = await POST(
      new Request('http://localhost/api/catalog/sets', {
        method: 'POST',
        body: JSON.stringify({ title: 'Sarees' }),
      }),
    )
    expect(res.status).toBe(201)
    await expect(res.json()).resolves.toEqual({
      set: expect.objectContaining({ id: 'col-1', metaSynced: true }),
    })
  })
})
