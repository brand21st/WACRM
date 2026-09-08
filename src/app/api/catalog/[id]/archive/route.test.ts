import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCatalogProduct: vi.fn(),
  upsertProduct: vi.fn(),
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
}))

vi.mock('@/lib/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/catalog')>()
  return {
    ...actual,
    getCatalogProduct: mocks.getCatalogProduct,
    upsertProduct: mocks.upsertProduct,
  }
})

import { POST as archive } from './route'
import { POST as publish } from '../publish/route'

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
  mocks.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
    supabase: {},
  })
})

describe('catalog archive and publish', () => {
  it('archives through Catalog Core with the existing product id', async () => {
    mocks.getCatalogProduct.mockResolvedValue(product)
    mocks.upsertProduct.mockResolvedValue({ ...product, status: 'archived', locked: true })
    const res = await archive(new Request('http://localhost/api/catalog/prod-1/archive'), {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.upsertProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'prod-1', status: 'archived', locked: true }),
    )
  })

  it('publishes through Catalog Core with the existing product id', async () => {
    mocks.getCatalogProduct.mockResolvedValue({ ...product, status: 'draft' })
    mocks.upsertProduct.mockResolvedValue({ ...product, status: 'active', locked: true })
    const res = await publish(new Request('http://localhost/api/catalog/prod-1/publish'), {
      params: Promise.resolve({ id: 'prod-1' }),
    })
    expect(res.status).toBe(200)
    expect(mocks.upsertProduct).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'prod-1', status: 'active', locked: true }),
    )
  })
})
