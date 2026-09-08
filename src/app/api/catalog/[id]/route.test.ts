import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCatalogProduct: vi.fn(),
  upsertProduct: vi.fn(),
  deleteProduct: vi.fn(),
  attachCatalogFacts: vi.fn(),
  buildCatalogWriteDraft: vi.fn(),
  listCollectionsByAccount: vi.fn(),
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
  upsertProduct: mocks.upsertProduct,
  deleteProduct: mocks.deleteProduct,
}))

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>()
  return {
    ...actual,
    getCatalogProduct: mocks.getCatalogProduct,
    upsertProduct: mocks.upsertProduct,
    deleteProduct: mocks.deleteProduct,
    attachCatalogFacts: mocks.attachCatalogFacts,
    buildCatalogWriteDraft: mocks.buildCatalogWriteDraft,
    listCollectionsByAccount: mocks.listCollectionsByAccount,
  }
})

import { DELETE, GET, PATCH } from './route'

const product = {
  id: 'prod-1',
  accountId: 'acct-1',
  handle: 'kurti',
  title: 'Kurti',
  description: '',
  status: 'active' as const,
  brand: null,
  productUrl: null,
  currency: 'INR',
  priceMin: 499,
  priceMax: 499,
  origin: 'shopify_import' as const,
  locked: false,
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  variants: [
    {
      id: 'v1',
      accountId: 'acct-1',
      productId: 'prod-1',
      title: 'Default',
      sku: 'K-1',
      price: 499,
      compareAtPrice: null,
      currency: 'INR',
      available: true,
      inventoryQuantity: 3,
      options: [],
      sortOrder: 0,
      retailerId: 'K-1',
    },
  ],
  media: [],
  externalIds: [],
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.getCatalogProduct.mockReset()
  mocks.upsertProduct.mockReset()
  mocks.deleteProduct.mockReset()
  mocks.attachCatalogFacts.mockReset()
  mocks.buildCatalogWriteDraft.mockReset()
  mocks.listCollectionsByAccount.mockReset()
})

describe('/api/catalog/[id]', () => {
  it('returns 404 for another account product', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', supabase: {} })
    mocks.getCatalogProduct.mockResolvedValue(null)
    const res = await GET(new Request('http://localhost/api/catalog/prod-1'), {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(404)
  })

  it('locks a Shopify-imported product on edit and upserts through Catalog Core', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {},
    })
    mocks.getCatalogProduct.mockResolvedValue(product)
    mocks.attachCatalogFacts.mockResolvedValue([product])
    mocks.listCollectionsByAccount.mockResolvedValue([])
    mocks.buildCatalogWriteDraft.mockResolvedValue({
      handle: 'kurti',
      title: 'Kurti edited',
      origin: 'shopify_import',
      locked: true,
    })
    mocks.upsertProduct.mockResolvedValue({ ...product, title: 'Kurti edited', locked: true })

    const res = await PATCH(
      new Request('http://localhost/api/catalog/prod-1', {
        method: 'PATCH',
        body: JSON.stringify({ title: 'Kurti edited' }),
      }),
      { params: Promise.resolve({ id: 'prod-1' }) },
    )
    expect(res.status).toBe(200)
    expect(mocks.buildCatalogWriteDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        existingProductId: 'prod-1',
        locked: true,
        origin: 'shopify_import',
      }),
    )
    expect(mocks.upsertProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'prod-1', locked: true }),
    )
  })

  it('deletes through Catalog Core', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {},
    })
    mocks.getCatalogProduct.mockResolvedValue(product)
    mocks.deleteProduct.mockResolvedValue(true)
    const res = await DELETE(new Request('http://localhost/api/catalog/prod-1'), {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.deleteProduct).toHaveBeenCalledWith(expect.anything(), 'acct-1', 'prod-1')
  })
})
