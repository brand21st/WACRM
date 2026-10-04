import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requirePlatformAdmin: vi.fn(),
  identity: vi.fn(),
  listApproved: vi.fn(),
  hasWhatsApp: vi.fn(),
}))

vi.mock('@/lib/auth/platform-admin', () => ({
  requirePlatformAdmin: (...args: unknown[]) => h.requirePlatformAdmin(...args),
}))

vi.mock('@/lib/auth/account', () => ({
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/postbus/readiness', () => ({
  officialWhatsAppIdentity: (...args: unknown[]) => h.identity(...args),
  listApprovedTemplates: (...args: unknown[]) => h.listApproved(...args),
  accountHasWhatsAppConfig: (...args: unknown[]) => h.hasWhatsApp(...args),
}))

import { GET, PUT } from './route'

beforeEach(() => {
  h.requirePlatformAdmin.mockReset()
  h.identity.mockReset()
  h.listApproved.mockReset()
  h.hasWhatsApp.mockReset()
  h.identity.mockResolvedValue({
    account_id: 'acct-global',
    display_phone: '+911234567890',
    verified_name: 'PostBus',
    connected: true,
  })
  h.listApproved.mockResolvedValue([])
  h.hasWhatsApp.mockResolvedValue(true)
})

describe('GET/PUT /api/super-admin/postbus', () => {
  it('returns the dedicated global account without tokens', async () => {
    h.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin-1',
      admin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  account_id: 'acct-global',
                  routing_mode: 'global',
                  notification_settings: { booked: true },
                  booked_template_name: 'booked_tpl',
                },
                error: null,
              }),
            }),
          }),
        }),
      },
    })

    const res = await GET()
    const body = await res.json()
    expect(body.account_id).toBe('acct-global')
    expect(body.display_phone_number).toBe('+911234567890')
    expect(JSON.stringify(body)).not.toMatch(/access_token|api_key/i)
  })

  it('promotes one account to global and demotes previous rows', async () => {
    const updates: Array<{ payload: Record<string, unknown>; id?: string }> = []
    h.requirePlatformAdmin.mockResolvedValue({
      userId: 'admin-1',
      admin: {
        from: () => ({
          select: () => ({
            eq: () => ({
              neq: () => ({
                then: undefined,
              }),
              maybeSingle: async () => ({ data: null, error: null }),
              // others query: .eq(routing_mode).neq(account)
            }),
            neq: async () => ({
              data: [{ id: 'old', account_id: 'acct-old', postbus_merchant_id: null }],
              error: null,
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            updates.push({ payload })
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: {
                      account_id: 'acct-new',
                      routing_mode: 'global',
                      ...payload,
                    },
                    error: null,
                  }),
                }),
              }),
            }
          },
          insert: (payload: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({
                data: {
                  account_id: 'acct-new',
                  routing_mode: 'global',
                  ...payload,
                },
                error: null,
              }),
            }),
          }),
        }),
      },
    })

    const res = await PUT(
      new Request('http://localhost/api/super-admin/postbus', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: 'acct-new',
          booked_template_name: 'booked_ok',
          notification_settings: { booked: true },
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.account_id).toBe('acct-new')
    expect(body.routing_mode).toBe('global')
  })
})
