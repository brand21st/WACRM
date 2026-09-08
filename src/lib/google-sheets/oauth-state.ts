import crypto from 'crypto'

const STATE_MAX_AGE_MS = 15 * 60 * 1000

function stateSecret(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not configured')
  return key
}

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', stateSecret())
    .update(payload)
    .digest('hex')
    .slice(0, 16)
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

export interface GoogleOAuthState {
  accountId: string
  userId: string
}

/** Signed state — binds the Google redirect to a workspace + admin. */
export function signGoogleOAuthState(
  accountId: string,
  userId: string,
): string {
  const ts = Date.now().toString(36)
  const payload = `${accountId}.${userId}.${ts}`
  return `${payload}.${hmac(payload)}`
}

export function verifyGoogleOAuthState(
  state: string,
  maxAgeMs = STATE_MAX_AGE_MS,
): GoogleOAuthState | null {
  const parts = state.split('.')
  if (parts.length !== 4) return null
  const [accountId, userId, ts, sig] = parts
  if (!accountId || !userId || !ts || !sig) return null
  const payload = `${accountId}.${userId}.${ts}`
  if (!safeEqual(sig, hmac(payload))) return null
  const tsMs = Number.parseInt(ts, 36)
  if (!Number.isFinite(tsMs) || Date.now() - tsMs > maxAgeMs || tsMs > Date.now() + 60_000) {
    return null
  }
  return { accountId, userId }
}
