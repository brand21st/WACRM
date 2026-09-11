import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getAccountSalesPattern: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  getAccountSalesPattern: mocks.getAccountSalesPattern,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.getAccountSalesPattern.mockReset()
})

describe('GET /api/ai/patterns/[id]', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET(new Request('http://localhost/api/ai/patterns/p1'), {
      params: Promise.resolve({ id: 'p1' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns 404 when the pattern is not in this account', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.getAccountSalesPattern.mockResolvedValue({
      available: true,
      pattern: null,
    })
    const res = await GET(new Request('http://localhost/api/ai/patterns/other'), {
      params: Promise.resolve({ id: 'other' }),
    })
    expect(res.status).toBe(404)
    expect(mocks.getAccountSalesPattern).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
      'other',
    )
  })

  it('returns available:false when the table is missing', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.getAccountSalesPattern.mockResolvedValue({
      available: false,
      pattern: null,
    })
    const res = await GET(new Request('http://localhost/api/ai/patterns/p1'), {
      params: Promise.resolve({ id: 'p1' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: false, pattern: null })
  })
})
