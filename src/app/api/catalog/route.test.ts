import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listProductsByAccount: vi.fn(),
  upsertProduct: vi.fn(),
  buildCatalogWriteDraft: vi.fn(),
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
    listProductsByAccount: mocks.listProductsByAccount,
    upsertProduct: mocks.upsertProduct,
    buildCatalogWriteDraft: mocks.buildCatalogWriteDraft,
  }
})

import { GET, POST } from './route'
import type { CatalogProduct } from '@/lib/catalog'

function product(): CatalogProduct {
  return {
    id: 'prod-1',
    accountId: 'acct-1',
    handle: 'red-bag',
    title: 'Red bag',
    description: '',
    status: 'active',
    brand: null,
    productUrl: null,
    currency: 'INR',
    priceMin: 499,
    priceMax: 499,
    origin: 'shopify_import',
    locked: false,
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    variants: [],
    media: [],
    externalIds: [],
  }
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.listProductsByAccount.mockReset()
  mocks.upsertProduct.mockReset()
  mocks.buildCatalogWriteDraft.mockReset()
})

describe('GET /api/catalog', () => {
  it('lists catalog products for the current account', async () => {
    const countReq = {
      eq: vi.fn(),
      or: vi.fn(),
      then: (
        resolve: (value: { count: number; error: null }) => unknown,
      ) => resolve({ count: 1, error: null }),
    }
    countReq.eq.mockReturnValue(countReq)
    countReq.or.mockReturnValue(countReq)
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {
        from: () => ({
          select: () => countReq,
        }),
      },
    })
    mocks.listProductsByAccount.mockResolvedValue([product()])

    const res = await GET(new Request('http://localhost/api/catalog?q=red&status=active'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.products).toEqual([
      {
        id: 'prod-1',
        title: 'Red bag',
        handle: 'red-bag',
        status: 'active',
        origin: 'shopify_import',
        currency: 'INR',
        priceMin: 499,
        priceMax: 499,
        variantCount: 0,
        imageUrl: null,
        sets: [],
      },
    ])
    expect(mocks.listProductsByAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        text: 'red',
        status: 'active',
        limit: 50,
      }),
    )
  })

  it('forwards collection into the product list', async () => {
    const countReq = {
      eq: vi.fn(),
      in: vi.fn(),
      or: vi.fn(),
      then: (
        resolve: (value: { count: number; error: null }) => unknown,
      ) => resolve({ count: 1, error: null }),
    }
    countReq.eq.mockReturnValue(countReq)
    countReq.in.mockReturnValue(countReq)
    countReq.or.mockReturnValue(countReq)
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {
        from: (table: string) => {
          if (table === 'catalog_product_collections') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () =>
                      Promise.resolve({
                        data: [{ product_id: 'prod-1' }],
                        error: null,
                      }),
                  }),
                }),
              }),
            }
          }
          return { select: () => countReq }
        },
      },
    })
    mocks.listProductsByAccount.mockResolvedValue([product()])

    const res = await GET(
      new Request('http://localhost/api/catalog?collection=col-1'),
    )
    expect(res.status).toBe(200)
    expect(mocks.listProductsByAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: 'acct-1',
        collectionId: 'col-1',
      }),
    )
  })

  it('returns an empty list when the collection has no products', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {
        from: (table: string) => {
          if (table === 'catalog_product_collections') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    order: () => Promise.resolve({ data: [], error: null }),
                  }),
                }),
              }),
            }
          }
          return { select: () => ({}) }
        },
      },
    })
    mocks.listProductsByAccount.mockResolvedValue([])

    const res = await GET(
      new Request('http://localhost/api/catalog?collection=col-empty'),
    )
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ products: [], total: 0 })
  })

  it('returns 503 when catalog_products is missing', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      supabase: { from: vi.fn() },
    })
    mocks.listProductsByAccount.mockRejectedValue({
      code: '42P01',
      message: 'relation "catalog_products" does not exist',
    })

    const res = await GET(new Request('http://localhost/api/catalog'))
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('CATALOG_SCHEMA_MISSING')
  })
})

describe('POST /api/catalog', () => {
  it('creates a WACRM product through Catalog Core', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {},
    })
    mocks.buildCatalogWriteDraft.mockResolvedValue({
      accountId: 'acct-1',
      handle: 'kurti',
      title: 'Kurti',
      origin: 'wacrm',
    })
    mocks.upsertProduct.mockResolvedValue(product())
    const res = await POST(
      new Request('http://localhost/api/catalog', {
        method: 'POST',
        body: JSON.stringify({ title: 'Kurti' }),
      }),
    )
    expect(res.status).toBe(201)
    expect(mocks.buildCatalogWriteDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ origin: 'wacrm', locked: false }),
    )
    expect(mocks.upsertProduct).toHaveBeenCalled()
  })
})
