import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api/v1/respond'

vi.mock('@/lib/postbus/readiness', () => ({
  accountHasWhatsAppConfig: vi.fn(async () => true),
  listApprovedTemplates: vi.fn(async () => []),
  officialWhatsAppIdentity: vi.fn(async () => ({
    account_id: 'acct-1',
    display_phone: null,
    verified_name: null,
    connected: false,
  })),
}))

import { throwPostBusSaveError, upsertGlobalPostBusAccount } from './global-admin'

describe('throwPostBusSaveError', () => {
  it('maps a missing routing_mode column to an ApiError operators can retry after 115', () => {
    expect(() =>
      throwPostBusSaveError({
        code: '42703',
        message: 'column postbus_integrations.routing_mode does not exist',
      }),
    ).toThrow(ApiError)
    try {
      throwPostBusSaveError({
        code: '42703',
        message: 'column postbus_integrations.routing_mode does not exist',
      })
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).message).toMatch(/115_postbus_global_mode/)
      expect((err as ApiError).status).toBe(500)
    }
  })
})

describe('upsertGlobalPostBusAccount', () => {
  it('does not collapse a missing routing_mode column to a generic Error', async () => {
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

    await expect(
      upsertGlobalPostBusAccount(
        { from: () => chain } as never,
        { accountId: 'acct-1', userId: 'user-1', body: {} },
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      message: expect.stringMatching(/routing_mode/),
    })
  })
})
