import { beforeEach, describe, expect, it, vi } from 'vitest'
import { unauthorized } from '@/lib/api/v1/respond'

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
}))

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: (...args: unknown[]) => h.requireApiKey(...args),
}))

vi.mock('@/lib/postbus/readiness', () => ({
  officialWhatsAppIdentity: vi.fn(async () => ({
    account_id: 'acct-1',
    display_phone: null,
    verified_name: null,
    connected: false,
  })),
  listApprovedTemplates: vi.fn(async () => []),
  accountHasWhatsAppConfig: vi.fn(async () => true),
}))

import { GET, PUT } from './route'

beforeEach(() => {
  h.requireApiKey.mockReset()
})

describe('GET /api/postbus/templates', () => {
  it('returns 200 with approved templates when routing_mode is not global yet', async () => {
    h.requireApiKey.mockResolvedValue({
      accountId: 'acct-1',
      createdBy: 'user-1',
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  account_id: 'acct-1',
                  routing_mode: 'merchant',
                  order_confirmation_template_name: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      },
    })
    const res = await GET(new Request('http://localhost/api/postbus/templates'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.account_id).toBe('acct-1')
    expect(Array.isArray(body.data.approved_templates)).toBe(true)
  })
})

describe('PUT /api/postbus/templates', () => {
  it('requires postbus:send', async () => {
    h.requireApiKey.mockRejectedValue(unauthorized())
    const res = await PUT(
      new Request('http://localhost/api/postbus/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('returns the missing routing_mode message instead of a generic 500', async () => {
    const missing = {
      code: '42703',
      message: 'column postbus_integrations.routing_mode does not exist',
    }
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = () => chain
    chain.neq = async () => ({ data: [], error: missing })
    chain.maybeSingle = async () => ({ data: null, error: missing })
    chain.insert = () => chain
    chain.update = () => chain
    chain.single = async () => ({ data: null, error: missing })
    h.requireApiKey.mockResolvedValue({
      accountId: 'acct-1',
      createdBy: 'user-1',
      supabase: { from: () => chain },
    })
    const res = await PUT(
      new Request('http://localhost/api/postbus/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booked_template_name: 'postbus_booked',
        }),
      }),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.message).toMatch(/115_postbus_global_mode/)
  })
})
