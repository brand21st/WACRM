import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  loadQueueOperationsHealth: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/queue/queue-health', () => ({
  loadQueueOperationsHealth: mocks.loadQueueOperationsHealth,
}))

import { ForbiddenError } from '@/lib/auth/account'
import { GET } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.loadQueueOperationsHealth.mockReset()
})

describe('GET /api/ai/intelligence/operations', () => {
  it('rejects non-admin callers before reading Redis', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())

    const response = await GET()

    expect(response.status).toBe(403)
    expect(mocks.loadQueueOperationsHealth).not.toHaveBeenCalled()
  })

  it('returns account-scoped, non-cacheable operational metadata', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1', userId: 'u1' })
    mocks.loadQueueOperationsHealth.mockResolvedValue({
      available: true,
      scope: 'deployment',
      checked_at: '2026-09-11T00:00:00.000Z',
      worker_heartbeats: [],
      queues: [],
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(body.account_id).toBe('acct-1')
    expect(JSON.stringify(body)).not.toMatch(/payload|data|redis_url/i)
  })
})
