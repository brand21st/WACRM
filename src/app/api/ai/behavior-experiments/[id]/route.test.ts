import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getAccountExperimentDetail: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/ai-intelligence-admin', () => ({
  getAccountExperimentDetail: mocks.getAccountExperimentDetail,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.getAccountExperimentDetail.mockReset()
})

describe('GET /api/ai/behavior-experiments/[id]', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await GET(
      new Request('http://localhost/api/ai/behavior-experiments/e1'),
      { params: Promise.resolve({ id: 'e1' }) },
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 for another account\'s experiment', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.getAccountExperimentDetail.mockResolvedValue(null)
    const res = await GET(
      new Request('http://localhost/api/ai/behavior-experiments/foreign'),
      { params: Promise.resolve({ id: 'foreign' }) },
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Not found')
    expect(JSON.stringify(body)).not.toContain('acct-')
    expect(mocks.getAccountExperimentDetail).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
      'foreign',
    )
  })
})
