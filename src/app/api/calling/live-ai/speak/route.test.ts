import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  speakLiveAiUtterance: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/calling/live-ai-realtime', () => ({
  speakLiveAiUtterance: mocks.speakLiveAiUtterance,
}))

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
  mocks.speakLiveAiUtterance.mockReset()
  mocks.requireRole.mockResolvedValue(context)
})

describe('POST /api/calling/live-ai/speak', () => {
  it('synthesizes spoken audio for a live call', async () => {
    mocks.speakLiveAiUtterance.mockResolvedValue({
      audioBase64: 'Zg==',
      mimeType: 'audio/mpeg',
    })
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: 'call-1', text: 'Hello' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ audioBase64: 'Zg==', mimeType: 'audio/mpeg' })
    expect(mocks.speakLiveAiUtterance).toHaveBeenCalledWith({
      accountId: 'acct-1',
      callId: 'call-1',
      text: 'Hello',
    })
  })

  it('rejects empty text', async () => {
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: 'call-1', text: '  ' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.speakLiveAiUtterance).not.toHaveBeenCalled()
  })
})
