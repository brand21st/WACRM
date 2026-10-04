import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  identity: vi.fn(),
}))

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: (...args: unknown[]) => h.requireApiKey(...args),
}))

vi.mock('@/lib/postbus/readiness', () => ({
  officialWhatsAppIdentity: (...args: unknown[]) => h.identity(...args),
}))

import { GET } from './route'

beforeEach(() => {
  h.requireApiKey.mockReset()
  h.identity.mockReset()
})

describe('GET /api/postbus/identity', () => {
  it('returns display fields and never includes tokens', async () => {
    h.requireApiKey.mockResolvedValue({
      accountId: 'acct-1',
      supabase: {},
    })
    h.identity.mockResolvedValue({
      account_id: 'acct-1',
      display_phone: '+91 86184 56029',
      verified_name: 'PostBus',
      connected: true,
    })

    const res = await GET(new Request('http://localhost/api/postbus/identity'))
    const body = await res.json()
    const serialized = JSON.stringify(body)
    expect(body.data.display_phone).toBe('+91 86184 56029')
    expect(body.data.verified_name).toBe('PostBus')
    expect(body.data.account_id).toBe('acct-1')
    expect(serialized).not.toMatch(/access_token|token|secret/i)
    expect(h.requireApiKey).toHaveBeenCalledWith(expect.anything(), 'postbus:send')
  })
})
