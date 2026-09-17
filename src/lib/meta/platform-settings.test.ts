import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  row: null as Record<string, string | null> | null,
  error: null as { message?: string } | null,
}))

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: h.row, error: h.error }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) =>
    value.startsWith('enc:') ? value.slice(4) : value,
}))

import {
  __resetPlatformMetaSettingsCache,
  isFacebookAppId,
  isFacebookLoginConfigId,
  resolveFacebookLoginConfig,
} from './platform-settings'

describe('facebook id validators', () => {
  it('accepts digit Facebook App IDs', () => {
    expect(isFacebookAppId('2367862230404408')).toBe(true)
    expect(isFacebookAppId('abc')).toBe(false)
  })

  it('accepts Facebook Login configuration IDs', () => {
    expect(isFacebookLoginConfigId('123456789012345')).toBe(true)
    expect(isFacebookLoginConfigId('cfg-abc_1')).toBe(true)
    expect(isFacebookLoginConfigId('no')).toBe(false)
  })
})

describe('resolveFacebookLoginConfig', () => {
  const prevApp = process.env.META_APP_ID
  const prevConfig = process.env.META_FACEBOOK_LOGIN_CONFIG_ID
  const prevSecret = process.env.META_APP_SECRET

  afterEach(() => {
    __resetPlatformMetaSettingsCache()
    h.row = null
    h.error = null
    if (prevApp === undefined) delete process.env.META_APP_ID
    else process.env.META_APP_ID = prevApp
    if (prevConfig === undefined) delete process.env.META_FACEBOOK_LOGIN_CONFIG_ID
    else process.env.META_FACEBOOK_LOGIN_CONFIG_ID = prevConfig
    if (prevSecret === undefined) delete process.env.META_APP_SECRET
    else process.env.META_APP_SECRET = prevSecret
  })

  it('overlays a stored configuration ID onto env app credentials', async () => {
    delete process.env.META_FACEBOOK_LOGIN_CONFIG_ID
    process.env.META_APP_ID = '11111'
    process.env.META_APP_SECRET = 'env-secret'
    h.row = {
      facebook_app_id: null,
      facebook_login_config_id: 'cfg-from-db',
      facebook_app_secret: null,
    }
    const resolved = await resolveFacebookLoginConfig()
    expect(resolved.appId).toBe('11111')
    expect(resolved.configId).toBe('cfg-from-db')
    expect(resolved.appSecret).toBe('env-secret')
    expect(resolved.source).toBe('database')
    expect(resolved.enabled).toBe(true)
  })

  it('prefers stored app id and secret over env', async () => {
    process.env.META_APP_ID = '11111'
    process.env.META_APP_SECRET = 'env-secret'
    process.env.META_FACEBOOK_LOGIN_CONFIG_ID = 'env-cfg'
    h.row = {
      facebook_app_id: '22222',
      facebook_login_config_id: 'db-cfg',
      facebook_app_secret: 'enc:db-secret',
    }
    const resolved = await resolveFacebookLoginConfig()
    expect(resolved).toMatchObject({
      appId: '22222',
      configId: 'db-cfg',
      appSecret: 'db-secret',
      source: 'database',
      enabled: true,
    })
  })

  it('falls back to env when the table is empty', async () => {
    process.env.META_APP_ID = '11111'
    process.env.META_FACEBOOK_LOGIN_CONFIG_ID = 'env-cfg'
    h.row = {
      facebook_app_id: null,
      facebook_login_config_id: null,
      facebook_app_secret: null,
    }
    const resolved = await resolveFacebookLoginConfig()
    expect(resolved.source).toBe('env')
    expect(resolved.appId).toBe('11111')
    expect(resolved.configId).toBe('env-cfg')
  })

  it('is disabled without an app id', async () => {
    delete process.env.META_APP_ID
    h.row = null
    const resolved = await resolveFacebookLoginConfig()
    expect(resolved.enabled).toBe(false)
    expect(resolved.source).toBe('none')
  })
})
