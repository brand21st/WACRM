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

import { PUT } from './route'

beforeEach(() => {
  h.requireApiKey.mockReset()
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
})
