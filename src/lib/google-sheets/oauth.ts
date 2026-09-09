const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'

export const GOOGLE_SHEETS_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/spreadsheets',
] as const

export class GoogleOAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'GoogleOAuthError'
    this.code = code
  }
}

async function requireGoogleOAuthClient() {
  const { resolveGoogleOAuthCredentials } = await import(
    '@/lib/google-sheets/platform-settings'
  )
  const creds = await resolveGoogleOAuthCredentials()
  if (!creds.configured) {
    throw new GoogleOAuthError(
      'not_configured',
      'Google OAuth is not configured',
    )
  }
  return creds
}

export async function buildGoogleAuthorizeUrl(args: {
  redirectUri: string
  state: string
}): Promise<string> {
  const { clientId } = await requireGoogleOAuthClient()
  const url = new URL(AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_SHEETS_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'false')
  url.searchParams.set('state', args.state)
  return url.toString()
}

export interface GoogleTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: string
  scopes: string[]
}

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

function expiresAtFrom(expiresIn: number | undefined): string {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 3600
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function parseTokenResponse(json: GoogleTokenResponse): Omit<
  GoogleTokenSet,
  'refreshToken'
> & { refreshToken: string | null } {
  if (!json.access_token) {
    throw new GoogleOAuthError(
      json.error === 'invalid_grant' ? 'invalid_grant' : 'oauth_failed',
      json.error_description || json.error || 'Google token exchange failed',
    )
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: expiresAtFrom(json.expires_in),
    scopes: typeof json.scope === 'string' ? json.scope.split(/\s+/) : [],
  }
}

export async function exchangeGoogleAuthorizationCode(args: {
  code: string
  redirectUri: string
}): Promise<GoogleTokenSet> {
  const { clientId, clientSecret } = await requireGoogleOAuthClient()
  const body = new URLSearchParams({
    code: args.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  const tokens = parseTokenResponse(json)
  if (!tokens.refreshToken) {
    throw new GoogleOAuthError(
      'oauth_failed',
      'Google did not return a refresh token',
    )
  }
  return { ...tokens, refreshToken: tokens.refreshToken }
}

export async function refreshGoogleAccessToken(
  refreshToken: string,
): Promise<GoogleTokenSet> {
  const { clientId, clientSecret } = await requireGoogleOAuthClient()
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = (await res.json().catch(() => ({}))) as GoogleTokenResponse
  const tokens = parseTokenResponse(json)
  return {
    ...tokens,
    refreshToken: tokens.refreshToken ?? refreshToken,
  }
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const body = new URLSearchParams({ token })
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }).catch(() => undefined)
}

export interface GoogleUserInfo {
  email: string | null
  id: string | null
}

export async function fetchGoogleUserInfo(
  accessToken: string,
): Promise<GoogleUserInfo> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    return { email: null, id: null }
  }
  const json = (await res.json().catch(() => ({}))) as {
    email?: string
    id?: string
  }
  return {
    email: typeof json.email === 'string' ? json.email : null,
    id: typeof json.id === 'string' ? json.id : null,
  }
}
