import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  requireRole: vi.fn(),
  ingestDocument: vi.fn(),
  loadEmbeddingsKey: vi.fn(),
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>(
    '@/lib/auth/account',
  )
  return {
    ...actual,
    getCurrentAccount: mocks.getCurrentAccount,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

vi.mock('@/lib/ai/knowledge', () => ({
  ingestDocument: (...args: unknown[]) => mocks.ingestDocument(...args),
}))

vi.mock('@/lib/ai/config', () => ({
  loadEmbeddingsKey: (...args: unknown[]) => mocks.loadEmbeddingsKey(...args),
}))

import { POST } from './route'

beforeEach(() => {
  mocks.getCurrentAccount.mockReset()
  mocks.requireRole.mockReset()
  mocks.ingestDocument.mockReset()
  mocks.loadEmbeddingsKey.mockReset()
  mocks.loadEmbeddingsKey.mockResolvedValue({ key: null, corrupt: false })
  mocks.ingestDocument.mockResolvedValue(undefined)
})

describe('POST /api/ai/knowledge', () => {
  it('creates a document and ingests title plus body', async () => {
    const insert = vi.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'doc-1' }, error: null }),
      }),
    })
    mocks.requireRole.mockResolvedValue({
      supabase: { from: () => ({ insert }) },
      accountId: 'acct-1',
      userId: 'user-1',
    })

    const res = await POST(
      new Request('https://app.test/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'About us', content: 'We make bags.' }),
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.id).toBe('doc-1')
    expect(mocks.ingestDocument).toHaveBeenCalledWith(
      expect.anything(),
      'acct-1',
      { embeddingsApiKey: null },
      'doc-1',
      'We make bags.',
      'About us',
    )
  })

  it('rejects missing title or content', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: { from: () => ({}) },
      accountId: 'acct-1',
      userId: 'user-1',
    })
    const res = await POST(
      new Request('https://app.test/api/ai/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'About us', content: '' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.ingestDocument).not.toHaveBeenCalled()
  })
})
