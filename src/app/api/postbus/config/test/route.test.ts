import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UnauthorizedError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  probeWhatsAppPhone: vi.fn(),
  accountHasSendApiKey: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/postbus/readiness', () => ({
  probeWhatsAppPhone: (...args: unknown[]) => mocks.probeWhatsAppPhone(...args),
  accountHasSendApiKey: (...args: unknown[]) => mocks.accountHasSendApiKey(...args),
}))

import { POST } from './route'

function chain(result: { data: unknown; error: unknown }) {
  const update = vi.fn(async () => ({ error: null }))
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => result,
          }),
        }),
        update: () => ({
          eq: update,
        }),
      }),
    },
    accountId: 'acct-1',
    userId: 'user-1',
  }
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.probeWhatsAppPhone.mockReset()
  mocks.accountHasSendApiKey.mockReset()
})

describe('POST /api/postbus/config/test', () => {
  it('returns invalid_account when the session has no account', async () => {
    mocks.requireRole.mockRejectedValue(new UnauthorizedError())
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(401)
    expect(body.ok).toBe(false)
    expect(body.code).toBe('invalid_account')
  })

  it('returns configuration_missing when merchant is absent', async () => {
    mocks.requireRole.mockResolvedValue(chain({ data: null, error: null }))
    const res = await POST()
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.code).toBe('configuration_missing')
  })

  it('returns whatsapp_not_configured when Cloud API is missing', async () => {
    mocks.requireRole.mockResolvedValue(
      chain({
        data: {
          id: 'row-1',
          account_id: 'acct-1',
          postbus_merchant_id: 'm-1',
          notification_settings: {},
        },
        error: null,
      }),
    )
    mocks.probeWhatsAppPhone.mockResolvedValue('missing')
    const res = await POST()
    const body = await res.json()
    expect(body.code).toBe('whatsapp_not_configured')
  })

  it('returns authentication_failed when no send-capable API key exists', async () => {
    mocks.requireRole.mockResolvedValue(
      chain({
        data: {
          id: 'row-1',
          account_id: 'acct-1',
          postbus_merchant_id: 'm-1',
          notification_settings: {},
        },
        error: null,
      }),
    )
    mocks.probeWhatsAppPhone.mockResolvedValue('ok')
    mocks.accountHasSendApiKey.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body.code).toBe('authentication_failed')
  })

  it('returns connection_successful when mapping, WhatsApp, and key exist', async () => {
    mocks.requireRole.mockResolvedValue(
      chain({
        data: {
          id: 'row-1',
          account_id: 'acct-1',
          postbus_merchant_id: 'm-1',
          notification_settings: {},
        },
        error: null,
      }),
    )
    mocks.probeWhatsAppPhone.mockResolvedValue('ok')
    mocks.accountHasSendApiKey.mockResolvedValue(true)
    const res = await POST()
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.code).toBe('connection_successful')
  })
})
