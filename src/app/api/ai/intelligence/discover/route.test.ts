import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  discoverAccountPatterns: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/discover-patterns', () => ({
  discoverAccountPatterns: mocks.discoverAccountPatterns,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.discoverAccountPatterns.mockReset()
})

describe('POST /api/ai/intelligence/discover', () => {
  it('does not call the global cron drain', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.discoverAccountPatterns.mockResolvedValue({
      accountId: 'acct-1',
      wrote: 0,
      staleUpdated: 0,
      skipped: true,
      reason: 'no_events',
    })
    const res = await POST()
    expect(res.status).toBe(200)
    expect(mocks.discoverAccountPatterns).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
    )
    const body = await res.json()
    expect(body.skipped).toBe(true)
  })

  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await POST()
    expect(res.status).toBe(403)
    expect(mocks.discoverAccountPatterns).not.toHaveBeenCalled()
  })
})
