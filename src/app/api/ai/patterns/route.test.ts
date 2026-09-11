import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  listAccountSalesPatterns: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  listAccountSalesPatterns: mocks.listAccountSalesPatterns,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.listAccountSalesPatterns.mockReset()
})

describe('GET /api/ai/patterns', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('lists only the caller account and returns available:false for missing schema', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.listAccountSalesPatterns.mockResolvedValue({
      available: false,
      patterns: [],
    })
    const res = await GET()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toEqual({ available: false, patterns: [] })
    expect(mocks.listAccountSalesPatterns).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
    )
  })
})
