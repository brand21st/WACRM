import { authRedirectOrigin } from '@/lib/hosts'

/**
 * Helpers for GET /auth/callback — PKCE email confirm, OAuth, and
 * password-reset links. Keep `next` on an allowlist so a crafted
 * confirmation URL cannot bounce the browser off-site.
 */

const EXACT_NEXT = new Set(['/dashboard', '/reset-password', '/super-admin'])

/** Invite tokens are 32-byte CSPRNG values, base64url (~43 chars). */
const JOIN_TOKEN = /^[A-Za-z0-9_-]+$/

export function safeAuthNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  let path = raw.trim()
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  if (
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('://') ||
    path.includes('\\') ||
    path.includes('..')
  ) {
    return null
  }
  const pathname = path.split('?')[0]?.split('#')[0] ?? path
  if (EXACT_NEXT.has(pathname)) return pathname
  const join = pathname.match(/^\/join\/([^/]+)$/)
  if (join && JOIN_TOKEN.test(join[1])) {
    return `/join/${join[1]}`
  }
  return null
}

export function postAuthPath(args: {
  next?: string | null
  invite?: string | null
  isPlatformAdmin?: boolean
}): string {
  const safeNext = safeAuthNextPath(args.next)
  if (safeNext === '/reset-password') return safeNext
  if (args.isPlatformAdmin) return '/super-admin'
  if (safeNext) return safeNext
  const invite = args.invite?.trim()
  if (invite && JOIN_TOKEN.test(invite)) {
    return `/join/${invite}`
  }
  return '/dashboard'
}

export function signupEmailRedirectTo(
  origin: string,
  inviteToken: string | null,
): string {
  const next = inviteToken
    ? `/join/${encodeURIComponent(inviteToken)}`
    : '/dashboard'
  return `${authRedirectOrigin(origin)}/auth/callback?next=${encodeURIComponent(next)}`
}

export function oauthCallbackRedirectTo(
  origin: string,
  inviteToken: string | null,
): string {
  const base = `${authRedirectOrigin(origin)}/auth/callback`
  const invite = inviteToken?.trim()
  if (!invite) return base
  return `${base}?invite=${encodeURIComponent(invite)}`
}

export function passwordResetEmailRedirectTo(origin: string): string {
  return `${authRedirectOrigin(origin)}/auth/callback?next=${encodeURIComponent('/reset-password')}`
}

/**
 * Supabase Site URL is often the origin root. If `/auth/callback` is
 * missing from Redirect URLs, verify/OAuth land on `/?code=` (or
 * `/?token_hash=` / `/?error=`). Middleware must forward those to
 * `/auth/callback` before the `/` bounce strips the query.
 */
export function isSupabaseSiteUrlAuthLanding(
  pathname: string,
  searchParams: { get: (name: string) => string | null },
): boolean {
  if (pathname !== '/') return false
  return Boolean(
    searchParams.get('code') ||
      searchParams.get('token_hash') ||
      searchParams.get('error'),
  )
}

export function signupDestination(args: {
  inviteToken: string | null
  isPlatformAdmin?: boolean
}): string {
  return postAuthPath({
    invite: args.inviteToken,
    isPlatformAdmin: args.isPlatformAdmin,
  })
}

/**
 * Supabase returns a user with an empty identities array when the
 * email is already registered and confirmation is on — signUp still
 * reports success so callers cannot enumerate accounts.
 */
export function isDuplicateSignupUser(user: {
  identities?: { id?: string }[] | null
} | null): boolean {
  return Boolean(user && Array.isArray(user.identities) && user.identities.length === 0)
}

export function authCallbackFailureCode(params: {
  error?: string | null
  error_code?: string | null
}): string | null {
  if (params.error_code === 'otp_expired') return 'otp_expired'
  if (params.error) return params.error
  return null
}

const EMAIL_OTP_TYPES = new Set([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
])

export function isEmailOtpType(
  value: string | null | undefined,
): value is 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email' {
  return Boolean(value && EMAIL_OTP_TYPES.has(value))
}

export function authCallbackLoginError(code: string): string {
  if (code === 'missing_code') return 'That sign-in link is missing a code. Request a new one.'
  if (code === 'otp_expired') {
    return 'That confirmation link has expired. Request a new one from sign up.'
  }
  if (code === 'exchange_failed') {
    return 'That sign-in link is invalid or expired. Request a new one.'
  }
  return 'Sign-in did not complete. Try again.'
}
