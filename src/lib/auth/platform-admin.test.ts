import { describe, expect, it } from 'vitest'
import { isMerchantAccountOwner, isPlatformAdminUser } from './platform-flag'
import type { User } from '@supabase/supabase-js'

function user(meta: Record<string, unknown>): User {
  return { app_metadata: meta } as User
}

describe('isPlatformAdminUser', () => {
  it('is true only when app_metadata.is_platform_admin is true', () => {
    expect(isPlatformAdminUser(user({ is_platform_admin: true }))).toBe(true)
    expect(isPlatformAdminUser(user({ is_platform_admin: false }))).toBe(false)
    expect(isPlatformAdminUser(user({}))).toBe(false)
    expect(isPlatformAdminUser(null)).toBe(false)
  })

  it('ignores user_metadata-style flags', () => {
    expect(
      isPlatformAdminUser({
        app_metadata: {},
        user_metadata: { is_platform_admin: true },
      } as unknown as User),
    ).toBe(false)
  })
})

describe('isMerchantAccountOwner', () => {
  it('excludes the Super Admin personal account', () => {
    expect(isMerchantAccountOwner('admin-1', 'admin-1')).toBe(false)
    expect(isMerchantAccountOwner('merchant-1', 'admin-1')).toBe(true)
    expect(isMerchantAccountOwner(null, 'admin-1')).toBe(false)
  })
})
