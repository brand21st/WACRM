import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveFacebookLoginConfig: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: vi.fn(async () => ({
    accountId: 'acct-1',
    userId: 'user-1',
    role: 'admin',
  })),
  toErrorResponse: (err: unknown) => {
    throw err
  },
}))

vi.mock('@/lib/meta/platform-settings', () => ({
  resolveFacebookLoginConfig: mocks.resolveFacebookLoginConfig,
}))

import { GET } from './route'

describe('GET /api/meta/launch-config', () => {
  afterEach(() => {
    mocks.resolveFacebookLoginConfig.mockReset()
  })

  it('returns Super Admin Facebook Login values', async () => {
    mocks.resolveFacebookLoginConfig.mockResolvedValue({
      appId: '2367862230404408',
      configId: 'cfg-from-db',
      appSecret: 'secret-must-not-leak',
      source: 'database',
      enabled: true,
      configured: true,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.configId).toBe('cfg-from-db')
    expect(body.appId).toBe('2367862230404408')
    expect(JSON.stringify(body)).not.toContain('secret-must-not-leak')
  })

  it('returns enabled: false without an app id', async () => {
    mocks.resolveFacebookLoginConfig.mockResolvedValue({
      appId: '',
      configId: '',
      appSecret: '',
      source: 'none',
      enabled: false,
      configured: false,
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(false)
  })
})
