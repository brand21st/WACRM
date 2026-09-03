import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runBillingSweep = vi.fn()

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({}),
}))

vi.mock('@/lib/billing/sweep', () => ({
  runBillingSweep: (...args: unknown[]) => runBillingSweep(...args),
}))

import { GET } from './route'

const ORIGINAL = process.env.AUTOMATION_CRON_SECRET

beforeEach(() => {
  runBillingSweep.mockResolvedValue({ scanned: 3, renewed: 1, expired: 0 })
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.AUTOMATION_CRON_SECRET
  else process.env.AUTOMATION_CRON_SECRET = ORIGINAL
})

describe('GET /api/billing/cron', () => {
  it('returns 503 when the cron secret is not configured', async () => {
    delete process.env.AUTOMATION_CRON_SECRET
    const res = await GET(new Request('https://app.test/api/billing/cron'))
    expect(res.status).toBe(503)
    expect(runBillingSweep).not.toHaveBeenCalled()
  })

  it('rejects a wrong secret', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/billing/cron', {
        headers: { 'x-cron-secret': 'nope' },
      }),
    )
    expect(res.status).toBe(401)
    expect(runBillingSweep).not.toHaveBeenCalled()
  })

  it('sweeps all package subscriptions when the secret matches', async () => {
    process.env.AUTOMATION_CRON_SECRET = 'expected-secret'
    const res = await GET(
      new Request('https://app.test/api/billing/cron', {
        headers: { 'x-cron-secret': 'expected-secret' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ scanned: 3, renewed: 1, expired: 0 })
    expect(runBillingSweep).toHaveBeenCalled()
  })
})
