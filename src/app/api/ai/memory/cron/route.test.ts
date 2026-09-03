import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drainChatMemoryJobs = vi.fn()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({}),
}))

vi.mock('@/lib/ai/chat-memory', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/chat-memory')>(
    '@/lib/ai/chat-memory',
  )
  return {
    ...actual,
    drainChatMemoryJobs: (...args: unknown[]) => drainChatMemoryJobs(...args),
  }
})

import { GET } from './route'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

beforeEach(() => {
  drainChatMemoryJobs.mockResolvedValue({ processed: 1, failed: 0, skipped: 2 })
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
})

describe('GET /api/ai/memory/cron', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(new Request('https://app.test/api/ai/memory/cron'))
    expect(res.status).toBe(503)
    expect(drainChatMemoryJobs).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/ai/memory/cron', {
        headers: { 'x-cron-secret': 'nope' },
      }),
    )
    expect(res.status).toBe(401)
    expect(drainChatMemoryJobs).not.toHaveBeenCalled()
  })

  it('drains idle sessions when the secret matches', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/ai/memory/cron', {
        headers: { 'x-cron-secret': 'expected-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 1, failed: 0, skipped: 2 })
    expect(drainChatMemoryJobs).toHaveBeenCalled()
  })
})
