import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadMetaCatalogPicker: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/catalog/meta-catalogs', () => ({
  loadMetaCatalogPicker: mocks.loadMetaCatalogPicker,
}))

import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadMetaCatalogPicker.mockReset()
})

describe('GET /api/catalog/meta-catalogs', () => {
  it('returns Graph catalogs with selected and primary ids', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', supabase: {} })
    mocks.loadMetaCatalogPicker.mockResolvedValue({
      catalogs: [{ id: '111', name: 'Main store' }],
      selectedIds: ['111'],
      primaryId: '111',
      reason: null,
    })

    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      catalogs: [{ id: '111', name: 'Main store' }],
      selectedIds: ['111'],
      primaryId: '111',
      reason: null,
    })
    expect(mocks.loadMetaCatalogPicker).toHaveBeenCalledWith({}, 'acct-1')
  })
})
