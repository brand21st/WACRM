import { describe, expect, it, vi } from 'vitest'

import { completeAuthCallback } from './complete-callback'

function mockClient(opts: {
  exchange?: (code: string) => Promise<{ data: unknown; error: { message: string } | null }>
  verify?: (args: unknown) => Promise<{ data: unknown; error: { message: string } | null }>
  from?: ReturnType<typeof vi.fn>
}) {
  return {
    auth: {
      exchangeCodeForSession: opts.exchange ?? vi.fn(),
      verifyOtp: opts.verify ?? vi.fn(),
    },
    from: opts.from ?? vi.fn(),
  }
}

describe('completeAuthCallback', () => {
  it('maps otp_expired without touching auth', async () => {
    const exchange = vi.fn()
    const result = await completeAuthCallback(mockClient({ exchange }) as never, {
      error: 'access_denied',
      error_code: 'otp_expired',
    })
    expect(result).toEqual({ ok: false, loginError: 'otp_expired' })
    expect(exchange).not.toHaveBeenCalled()
  })

  it('exchanges a PKCE code and sends merchants to dashboard', async () => {
    const result = await completeAuthCallback(
      mockClient({
        exchange: async () => ({
          data: { user: { id: 'u1', app_metadata: {}, user_metadata: {} } },
          error: null,
        }),
      }) as never,
      { code: 'abc', next: '/dashboard' },
    )
    expect(result).toEqual({ ok: true, dest: '/dashboard' })
  })

  it('verifies token_hash signup links', async () => {
    const verify = vi.fn(async () => ({
      data: { user: { id: 'u1', app_metadata: {}, user_metadata: {} } },
      error: null,
    }))
    const result = await completeAuthCallback(mockClient({ verify }) as never, {
      token_hash: 'hash-1',
      type: 'signup',
    })
    expect(verify).toHaveBeenCalledWith({ token_hash: 'hash-1', type: 'signup' })
    expect(result).toEqual({ ok: true, dest: '/dashboard' })
  })

  it('returns exchange_failed when the code is rejected', async () => {
    const result = await completeAuthCallback(
      mockClient({
        exchange: async () => ({
          data: { user: null },
          error: { message: 'invalid request: both auth code and code verifier should be non-empty' },
        }),
      }) as never,
      { code: 'dead' },
    )
    expect(result).toEqual({ ok: false, loginError: 'exchange_failed' })
  })

  it('sends platform admins to super-admin', async () => {
    const result = await completeAuthCallback(
      mockClient({
        exchange: async () => ({
          data: {
            user: {
              id: 'admin',
              app_metadata: { is_platform_admin: true },
              user_metadata: {},
            },
          },
          error: null,
        }),
      }) as never,
      { code: 'abc' },
    )
    expect(result).toEqual({ ok: true, dest: '/super-admin' })
  })
})
