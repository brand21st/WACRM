import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drainVoiceInboundJobs = vi.fn()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}))

vi.mock('@/lib/ai/voice-inbound-jobs', () => ({
  drainVoiceInboundJobs: (...args: unknown[]) => drainVoiceInboundJobs(...args),
}))

import { GET } from './route'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

beforeEach(() => {
  drainVoiceInboundJobs.mockResolvedValue({ processed: 2, failed: 0 })
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
})

describe('GET /api/voice/cron', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(new Request('https://app.test/api/voice/cron'))
    expect(res.status).toBe(503)
    expect(drainVoiceInboundJobs).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/voice/cron', {
        headers: { 'x-cron-secret': 'nope' },
      }),
    )
    expect(res.status).toBe(401)
    expect(drainVoiceInboundJobs).not.toHaveBeenCalled()
  })

  it('drains due jobs when the secret matches', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/voice/cron', {
        headers: { 'x-cron-secret': 'expected-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 2, failed: 0 })
    expect(drainVoiceInboundJobs).toHaveBeenCalled()
  })
})
