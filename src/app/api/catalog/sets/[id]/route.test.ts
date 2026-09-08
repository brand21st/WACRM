import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCollectionById: vi.fn(),
  upsertCollection: vi.fn(),
  deleteCollection: vi.fn(),
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
  deleteCollection: mocks.deleteCollection,
}))

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>()
  return {
    ...actual,
    getCollectionById: mocks.getCollectionById,
    upsertCollection: mocks.upsertCollection,
    deleteCollection: mocks.deleteCollection,
    buildCatalogSetDraft: mocks.buildCatalogSetDraft,
  }
})

import { DELETE, GET, PATCH } from './route'

const set = {
  id: 'col-1',
  accountId: 'acct-1',
  handle: 'sarees',
  title: 'Sarees',
  status: 'active' as const,
  productCount: 0,
  productIds: [],
  metaProductSetId: null,
}

const params = { params: Promise.resolve({ id: 'col-1' }) }

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.getCollectionById.mockReset()
  mocks.upsertCollection.mockReset()
  mocks.deleteCollection.mockReset()
  mocks.buildCatalogSetDraft.mockReset()
})

describe('GET /api/catalog/sets/[id]', () => {
  it('returns 404 for another account', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acct-b' })
    mocks.getCollectionById.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/catalog/sets/col-1'), params)
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/catalog/sets/[id]', () => {
  it('updates a set', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.getCollectionById.mockResolvedValue(set)
    mocks.buildCatalogSetDraft.mockResolvedValue({
      id: 'col-1',
      accountId: 'acct-1',
      handle: 'sarees',
      title: 'Festive sarees',
      productIds: [],
    })
    mocks.upsertCollection.mockResolvedValue({ ...set, title: 'Festive sarees' })
    const res = await PATCH(
      new Request('http://localhost/api/catalog/sets/col-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Festive sarees' }),
      }),
      params,
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      set: expect.objectContaining({ title: 'Festive sarees' }),
    })
  })
})

describe('DELETE /api/catalog/sets/[id]', () => {
  it('deletes a set', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {},
      accountId: 'acct-1',
      userId: 'user-1',
    })
    mocks.getCollectionById.mockResolvedValue(set)
    mocks.deleteCollection.mockResolvedValue(true)
    const res = await DELETE(
      new Request('http://localhost/api/catalog/sets/col-1'),
      params,
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ success: true })
  })
})
