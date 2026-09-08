import { describe, expect, it } from 'vitest'
import {
  authCallbackFailureCode,
  isDuplicateSignupUser,
  isEmailOtpType,
  isSupabaseSiteUrlAuthLanding,
  postAuthPath,
  safeAuthNextPath,
  signupDestination,
  signupEmailRedirectTo,
} from './callback'

describe('safeAuthNextPath', () => {
  it('allows dashboard, reset-password, and super-admin', () => {
    expect(safeAuthNextPath('/dashboard')).toBe('/dashboard')
    expect(safeAuthNextPath('/reset-password')).toBe('/reset-password')
    expect(safeAuthNextPath('/super-admin')).toBe('/super-admin')
  })

  it('allows /join/{token} for base64url invite tokens', () => {
    expect(safeAuthNextPath('/join/abc_DEF-123')).toBe('/join/abc_DEF-123')
  })

  it('rejects open redirects and traversal', () => {
    expect(safeAuthNextPath('https://evil.example/phish')).toBeNull()
    expect(safeAuthNextPath('//evil.example')).toBeNull()
    expect(safeAuthNextPath('/dashboard/../login')).toBeNull()
    expect(safeAuthNextPath('/join/../settings')).toBeNull()
    expect(safeAuthNextPath('/inbox')).toBeNull()
    expect(safeAuthNextPath(null)).toBeNull()
  })
})

describe('postAuthPath', () => {
  it('sends password reset to /reset-password even for admins', () => {
    expect(
      postAuthPath({ next: '/reset-password', isPlatformAdmin: true }),
    ).toBe('/reset-password')
  })

  it('sends platform admins to /super-admin', () => {
    expect(postAuthPath({ isPlatformAdmin: true, next: '/dashboard' })).toBe(
      '/super-admin',
    )
  })

  it('uses invite when next is missing', () => {
    expect(postAuthPath({ invite: 'tok_1' })).toBe('/join/tok_1')
  })

  it('falls back to dashboard', () => {
    expect(postAuthPath({})).toBe('/dashboard')
    expect(postAuthPath({ next: '/inbox' })).toBe('/dashboard')
  })
})

describe('signupEmailRedirectTo', () => {
  it('always lands on /auth/callback with an allowlisted next', () => {
    expect(signupEmailRedirectTo('https://cloud.vachat.in', null)).toBe(
      'https://cloud.vachat.in/auth/callback?next=%2Fdashboard',
    )
    expect(
      signupEmailRedirectTo('https://cloud.vachat.in/', 'inv-token'),
    ).toBe(
      'https://cloud.vachat.in/auth/callback?next=%2Fjoin%2Finv-token',
    )
  })
})

describe('isSupabaseSiteUrlAuthLanding', () => {
  const params = (query: string) => new URLSearchParams(query)

  it('detects PKCE code, token_hash, and OAuth error on /', () => {
    expect(isSupabaseSiteUrlAuthLanding('/', params('code=abc'))).toBe(true)
    expect(isSupabaseSiteUrlAuthLanding('/', params('token_hash=pkce_1'))).toBe(
      true,
    )
    expect(isSupabaseSiteUrlAuthLanding('/', params('error=access_denied'))).toBe(
      true,
    )
  })

  it('ignores / without auth params and other paths that carry a code', () => {
    expect(isSupabaseSiteUrlAuthLanding('/', params(''))).toBe(false)
    expect(
      isSupabaseSiteUrlAuthLanding('/auth/callback', params('code=abc')),
    ).toBe(false)
    expect(
      isSupabaseSiteUrlAuthLanding(
        '/api/shopify/oauth/callback',
        params('code=shopify'),
      ),
    ).toBe(false)
  })
})

describe('signupDestination', () => {
  it('sends a sessioned signup to join or dashboard', () => {
    expect(signupDestination({ inviteToken: 'abc' })).toBe('/join/abc')
    expect(signupDestination({ inviteToken: null })).toBe('/dashboard')
  })
})

describe('authCallbackFailureCode', () => {
  it('prefers otp_expired over generic access_denied', () => {
    expect(
      authCallbackFailureCode({
        error: 'access_denied',
        error_code: 'otp_expired',
      }),
    ).toBe('otp_expired')
  })
})

describe('isEmailOtpType', () => {
  it('allows signup and recovery', () => {
    expect(isEmailOtpType('signup')).toBe(true)
    expect(isEmailOtpType('recovery')).toBe(true)
    expect(isEmailOtpType('not-a-type')).toBe(false)
  })
})

describe('isDuplicateSignupUser', () => {
  it('detects the empty-identities already-registered response', () => {
    expect(isDuplicateSignupUser({ identities: [] })).toBe(true)
    expect(isDuplicateSignupUser({ identities: [{ id: '1' }] })).toBe(false)
    expect(isDuplicateSignupUser(null)).toBe(false)
  })
})
