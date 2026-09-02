import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  startLiveAiRealtimeCall: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() => Response.json({ error: 'auth failed' }, { status: 403 })),
}))

vi.mock('@/lib/calling/live-ai-realtime', () => ({
  startLiveAiRealtimeCall: mocks.startLiveAiRealtimeCall,
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
  mocks.startLiveAiRealtimeCall.mockReset()
  mocks.requireRole.mockResolvedValue(context)
})

describe('POST /api/calling/live-ai/realtime', () => {
  it('proxies a valid SDP offer', async () => {
    mocks.startLiveAiRealtimeCall.mockResolvedValue({ sdp: 'v=0\r\nanswer' })
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: 'call-1', sdp: 'v=0\r\noffer' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sdp: 'v=0\r\nanswer' })
    expect(mocks.startLiveAiRealtimeCall).toHaveBeenCalledWith({
      accountId: 'acct-1',
      callId: 'call-1',
      sdp: 'v=0\r\noffer',
    })
  })

  it('rejects a missing SDP', async () => {
    const res = await POST(
      new Request('http://localhost/api/calling/live-ai/realtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: 'call-1', sdp: 'not-sdp' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.startLiveAiRealtimeCall).not.toHaveBeenCalled()
  })
})
