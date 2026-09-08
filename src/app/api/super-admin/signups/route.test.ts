import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '@/lib/auth/account'

type Row = Record<string, unknown>

const store: Record<string, Row[]> = {
  accounts: [],
  profiles: [],
  account_subscriptions: [],
}

function createBuilder(rows: Row[]) {
  const state = {
    neq: null as { col: string; val: unknown } | null,
    in: null as { col: string; vals: unknown[] } | null,
    ascending: false,
  }
  const builder: Record<string, unknown> = {}
  const apply = () => {
    let out = [...rows]
    if (state.neq) {
      out = out.filter((r) => r[state.neq!.col] !== state.neq!.val)
    }
    if (state.in) {
      out = out.filter((r) => state.in!.vals.includes(r[state.in!.col]))
    }
    if ('created_at' in (out[0] ?? {})) {
      out.sort((a, b) => {
        const left = String(a.created_at)
        const right = String(b.created_at)
        return state.ascending ? left.localeCompare(right) : right.localeCompare(left)
      })
    }
    return { data: out, error: null }
  }
  builder.select = () => builder
  builder.neq = (col: string, val: unknown) => {
    state.neq = { col, val }
    return builder
  }
  builder.in = (col: string, vals: unknown[]) => {
    state.in = { col, vals }
    return builder
  }
  builder.order = (_col: string, opts?: { ascending?: boolean }) => {
    state.ascending = opts?.ascending === true
    return builder
  }
  builder.limit = () => builder
  builder.then = (
    resolve: (value: { data: Row[]; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(apply()).then(resolve, reject)
  return builder
}

const requirePlatformAdmin = vi.fn()

vi.mock('@/lib/auth/platform-admin', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/platform-admin')>(
    '@/lib/auth/platform-admin',
  )
  return {
    ...actual,
    requirePlatformAdmin: () => requirePlatformAdmin(),
  }
})

vi.mock('@/lib/rate-limit', () => ({
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
  checkRateLimit: () => ({ success: true, remaining: 29, reset: Date.now(), limit: 30 }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
}))

import { GET } from './route'

beforeEach(() => {
  store.accounts = [
    {
      id: 'acc-new',
      name: 'Zulu Co',
      owner_user_id: 'merchant-1',
      status: 'active',
      created_at: '2026-09-07T10:00:00.000Z',
    },
    {
      id: 'acc-old',
      name: 'Alpha Co',
      owner_user_id: 'merchant-2',
      status: 'active',
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'acc-admin',
      name: 'Platform',
      owner_user_id: 'admin-1',
      status: 'active',
      created_at: '2025-01-01T00:00:00.000Z',
    },
  ]
  store.profiles = [
    { user_id: 'merchant-1', email: 'new@test.com', full_name: 'New Owner' },
    { user_id: 'merchant-2', email: 'old@test.com', full_name: 'Old Owner' },
  ]
  store.account_subscriptions = [
    {
      account_id: 'acc-new',
      status: 'active',
      current_period_end: '2026-10-01T00:00:00.000Z',
      billing_packages: { name: 'Free' },
    },
    {
      account_id: 'acc-old',
      status: 'cancelled',
      current_period_end: '2025-02-01T00:00:00.000Z',
      billing_packages: { name: 'Pro' },
    },
  ]
  requirePlatformAdmin.mockReset()
  requirePlatformAdmin.mockResolvedValue({
    userId: 'admin-1',
    user: { id: 'admin-1' },
    admin: {
      from: (table: string) => createBuilder(store[table] ?? []),
    },
  })
})

describe('GET /api/super-admin/signups', () => {
  it('rejects callers who are not platform admin', async () => {
    requirePlatformAdmin.mockRejectedValue(new UnauthorizedError())
    const res = await GET(new Request('https://app.test/api/super-admin/signups'))
    expect(res.status).toBe(401)
  })

  it('counts live subscriptions as active and hides the admin tenant', async () => {
    const res = await GET(new Request('https://app.test/api/super-admin/signups'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.totals).toEqual({ signups: 2, active: 1, inactive: 1 })
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['acc-new', 'acc-old'])
    expect(body.rows[0].active).toBe(true)
    expect(body.rows[1].active).toBe(false)
    expect(body.buckets).toEqual(
      expect.arrayContaining([expect.objectContaining({ count: expect.any(Number) })]),
    )
  })

  it('sorts oldest first when asked', async () => {
    const res = await GET(
      new Request('https://app.test/api/super-admin/signups?sort=oldest'),
    )
    const body = await res.json()
    expect(body.rows.map((r: { id: string }) => r.id)).toEqual(['acc-old', 'acc-new'])
  })

  it('treats cancelled-but-unexpired subscriptions as active', async () => {
    store.account_subscriptions[1] = {
      account_id: 'acc-old',
      status: 'cancelled',
      current_period_end: '2099-01-01T00:00:00.000Z',
      billing_packages: { name: 'Pro' },
    }
    const res = await GET(new Request('https://app.test/api/super-admin/signups'))
    const body = await res.json()
    expect(body.totals.active).toBe(2)
    expect(body.totals.inactive).toBe(0)
  })
})
