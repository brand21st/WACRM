import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drainDueConversationFollowUps = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({}),
}))

vi.mock('@/lib/ai/follow-up', () => ({
  drainDueConversationFollowUps: (...args: unknown[]) =>
    drainDueConversationFollowUps(...args),
}))

import { GET } from './route'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

beforeEach(() => {
  drainDueConversationFollowUps.mockResolvedValue({ processed: 2 })
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
})

describe('GET /api/ai/follow-up/cron', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(new Request('https://app.test/api/ai/follow-up/cron'))
    expect(res.status).toBe(503)
    expect(drainDueConversationFollowUps).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/ai/follow-up/cron', {
        headers: { 'x-cron-secret': 'nope' },
      }),
    )
    expect(res.status).toBe(401)
    expect(drainDueConversationFollowUps).not.toHaveBeenCalled()
  })

  it('drains due follow-ups when the secret matches', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/ai/follow-up/cron', {
        headers: { 'x-cron-secret': 'expected-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 2 })
    expect(drainDueConversationFollowUps).toHaveBeenCalled()
  })
})
