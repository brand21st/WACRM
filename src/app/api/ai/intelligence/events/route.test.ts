import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadObservationEvents: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/observation-admin', () => ({
  loadObservationEvents: mocks.loadObservationEvents,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadObservationEvents.mockReset()
})

describe('GET /api/ai/intelligence/events', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET()
    expect(res.status).toBe(403)
  })

  it('scopes the report to the caller account', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.loadObservationEvents.mockResolvedValue({
      available: true,
      total: 0,
      by_type: [],
      first_created_at: null,
      last_created_at: null,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(mocks.loadObservationEvents).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
    )
  })
})
