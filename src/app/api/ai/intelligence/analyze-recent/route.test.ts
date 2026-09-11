import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  enqueueBoundedConversationAnalyze: vi.fn(),
  previewBoundedConversationAnalyze: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({ mocked: true }),
}))

vi.mock('@/lib/ai/intelligence/enqueue-bounded-analyze', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@/lib/ai/intelligence/enqueue-bounded-analyze')
    >()
  return {
    ...actual,
    enqueueBoundedConversationAnalyze: mocks.enqueueBoundedConversationAnalyze,
    previewBoundedConversationAnalyze: mocks.previewBoundedConversationAnalyze,
  }
})

import { ForbiddenError } from '@/lib/auth/account'
import { GET, POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.enqueueBoundedConversationAnalyze.mockReset()
  mocks.previewBoundedConversationAnalyze.mockReset()
})

describe('GET /api/ai/intelligence/analyze-recent', () => {
  it('previews only the caller account and never accepts accountId', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    mocks.previewBoundedConversationAnalyze.mockResolvedValue({
      available: true,
      selected_conversations: 10,
    })
    const res = await GET(
      new Request('http://localhost/api/ai/intelligence/analyze-recent?windowDays=7&maxConversations=10')
    )
    expect(res.status).toBe(200)
    expect(mocks.previewBoundedConversationAnalyze).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
      { windowDays: 7, maxConversations: 10 },
    )
  })
})

describe('POST /api/ai/intelligence/analyze-recent', () => {
  it('returns 403 for non-admins', async () => {
    mocks.requireRole.mockRejectedValue(new ForbiddenError())
    const res = await POST(
      new Request('http://localhost/api/ai/intelligence/analyze-recent', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'ANALYZE RECENT CONVERSATIONS' }),
      })
    )
    expect(res.status).toBe(403)
    expect(mocks.enqueueBoundedConversationAnalyze).not.toHaveBeenCalled()
  })

  it('rejects a client-supplied accountId even with confirmation', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    const res = await POST(
      new Request('http://localhost/api/ai/intelligence/analyze-recent', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: 'ANALYZE RECENT CONVERSATIONS',
          accountId: 'acct-other',
        }),
      })
    )
    expect(res.status).toBe(400)
    expect(mocks.enqueueBoundedConversationAnalyze).not.toHaveBeenCalled()
  })

  it('requires typed confirmation before enqueueing the session account', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'acct-1' })
    const denied = await POST(
      new Request('http://localhost/api/ai/intelligence/analyze-recent', {
        method: 'POST',
        body: JSON.stringify({}),
      })
    )
    expect(denied.status).toBe(400)

    mocks.enqueueBoundedConversationAnalyze.mockResolvedValue({
      considered: 2,
      queued: 2,
      skipped: 0,
      queue_unavailable: false,
      window_days: 7,
      max_conversations: 10,
    })
    const res = await POST(
      new Request('http://localhost/api/ai/intelligence/analyze-recent', {
        method: 'POST',
        body: JSON.stringify({
          confirmation: 'ANALYZE RECENT CONVERSATIONS',
          windowDays: 7,
          maxConversations: 10,
        }),
      })
    )
    expect(res.status).toBe(200)
    expect(mocks.enqueueBoundedConversationAnalyze).toHaveBeenCalledWith(
      { mocked: true },
      'acct-1',
      { windowDays: 7, maxConversations: 10 },
    )
  })
})
