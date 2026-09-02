import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  executeLiveAiTool: vi.fn(),
  persistLiveAiTranscript: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/calling/live-ai-tool', async () => {
  const actual = await vi.importActual<typeof import('@/lib/calling/live-ai-tool')>(
    '@/lib/calling/live-ai-tool',
  )
  return {
    ...actual,
    executeLiveAiTool: mocks.executeLiveAiTool,
    persistLiveAiTranscript: mocks.persistLiveAiTranscript,
  }
})

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>('@/lib/rate-limit')
  return {
    ...actual,
    checkRateLimit: () => ({ success: true }),
    rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  }
})

import { POST } from './route'

const context = {
  supabase: {},
  accountId: 'acct-1',
  userId: 'user-1',
  role: 'agent',
  account: { id: 'acct-1', name: 'Acme' },
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.executeLiveAiTool.mockReset()
  mocks.persistLiveAiTranscript.mockReset()
  mocks.requireRole.mockResolvedValue(context)
})

describe('POST /api/calling/live-ai/tool', () => {
  it('executes a Shopify tool', async () => {
    mocks.executeLiveAiTool.mockResolvedValue({ output: '{"ok":true}', handoff: false })
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: 'call-1',
          name: 'search_products',
          arguments: { query: 'bag' },
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ output: '{"ok":true}', handoff: false })
    expect(mocks.executeLiveAiTool).toHaveBeenCalledWith({
      accountId: 'acct-1',
      userId: 'user-1',
      callId: 'call-1',
      name: 'search_products',
      arguments: { query: 'bag' },
    })
  })

  it('persists a transcript', async () => {
    mocks.persistLiveAiTranscript.mockResolvedValue({ persisted: true })
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'transcript',
          callId: 'call-1',
          role: 'customer',
          text: 'hello',
          itemId: 'item_1',
        }),
      }),
    )
    expect(res.status).toBe(200)
    expect(mocks.persistLiveAiTranscript).toHaveBeenCalledWith({
      accountId: 'acct-1',
      callId: 'call-1',
      role: 'customer',
      text: 'hello',
      itemId: 'item_1',
    })
  })
})
