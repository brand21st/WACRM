import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const drainDueConversationFollowUps = vi.fn()
const resumePendingExecution = vi.fn()
const from = vi.fn()

vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({ from }),
}))

vi.mock('@/lib/ai/follow-up', () => ({
  drainDueConversationFollowUps: (...args: unknown[]) =>
    drainDueConversationFollowUps(...args),
}))

vi.mock('@/lib/automations/engine', () => ({
  resumePendingExecution: (...args: unknown[]) => resumePendingExecution(...args),
}))

import { GET } from './route'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

function pendingQuery(result: { data: unknown[] | null; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        lte: () => ({
          order: () => ({
            limit: () => Promise.resolve(result),
          }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  drainDueConversationFollowUps.mockResolvedValue({ processed: 1 })
  resumePendingExecution.mockResolvedValue(undefined)
  from.mockReturnValue(pendingQuery({ data: [], error: null }))
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
})

describe('GET /api/automations/cron', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(new Request('https://app.test/api/automations/cron'))
    expect(res.status).toBe(503)
    expect(drainDueConversationFollowUps).not.toHaveBeenCalled()
  })

  it('drains due follow-ups even when no automation waits are due', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/automations/cron', {
        headers: { 'x-cron-secret': 'expected-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ processed: 0, followUps: 1 })
    expect(drainDueConversationFollowUps).toHaveBeenCalled()
    expect(resumePendingExecution).not.toHaveBeenCalled()
  })
})
