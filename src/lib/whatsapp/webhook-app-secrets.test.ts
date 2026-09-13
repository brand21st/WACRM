import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getWebhookAppSecrets,
  invalidateWebhookAppSecretsCache,
} from './webhook-app-secrets'

const mockFrom = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => `decrypted:${value}`,
}))

describe('getWebhookAppSecrets', () => {
  beforeEach(() => {
    invalidateWebhookAppSecretsCache()
    vi.stubEnv('META_APP_SECRET', 'platform-secret')
    mockFrom.mockReturnValue({
      select: () => ({
        not: () =>
          Promise.resolve({
            data: [{ meta_app_secret: 'enc-tenant' }],
            error: null,
          }),
      }),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    invalidateWebhookAppSecretsCache()
  })

  it('includes the platform secret and decrypted per-tenant secrets', async () => {
    const secrets = await getWebhookAppSecrets()
    expect(secrets).toContain('platform-secret')
    expect(secrets).toContain('decrypted:enc-tenant')
  })

  it('returns cached secrets within the TTL', async () => {
    await getWebhookAppSecrets()
    await getWebhookAppSecrets()
    expect(mockFrom).toHaveBeenCalledTimes(1)
  })
})
