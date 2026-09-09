import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  enrichInboundCartItems: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/commerce/enrich-cart-items', () => ({
  enrichInboundCartItems: mocks.enrichInboundCartItems,
}))

import { GET, parseRetailerIds } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.enrichInboundCartItems.mockReset()
})

describe('parseRetailerIds', () => {
  it('dedupes, trims, and caps at 20', () => {
    expect(parseRetailerIds(' BAG-RED,BAG-RED, 4821 ')).toEqual(['BAG-RED', '4821'])
    expect(parseRetailerIds(Array.from({ length: 25 }, (_, i) => `id-${i}`).join(','))).toHaveLength(
      20,
    )
    expect(parseRetailerIds('')).toEqual([])
    expect(parseRetailerIds(null)).toEqual([])
  })
})

describe('GET /api/catalog/by-retailer', () => {
  it('returns catalog names and prices for retailer ids', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acct-a' })
    mocks.enrichInboundCartItems.mockResolvedValue([
      {
        product_retailer_id: 'BAG-RED',
        quantity: 1,
        name: 'Red Bag',
        item_price: 499,
        currency: 'INR',
        image_url: 'https://cdn.example/red-bag.jpg',
      },
    ])

    const res = await GET(
      new Request('http://localhost/api/catalog/by-retailer?ids=BAG-RED'),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      items: [
        {
          retailer_id: 'BAG-RED',
          name: 'Red Bag',
          price: 499,
          compare_at: null,
          currency: 'INR',
          image_url: 'https://cdn.example/red-bag.jpg',
        },
      ],
    })
    expect(mocks.enrichInboundCartItems).toHaveBeenCalledWith(
      {},
      'acct-a',
      [{ product_retailer_id: 'BAG-RED', quantity: 1 }],
    )
  })

  it('returns an empty list when no ids are given', async () => {
    mocks.requireRole.mockResolvedValue({ supabase: {}, accountId: 'acct-a' })
    const res = await GET(new Request('http://localhost/api/catalog/by-retailer'))
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ items: [] })
    expect(mocks.enrichInboundCartItems).not.toHaveBeenCalled()
  })
})
