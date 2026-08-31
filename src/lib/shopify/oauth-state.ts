import crypto from 'crypto'

function stateSecret(): string {
  const key = process.env.ENCRYPTION_KEY
  if (!key) throw new Error('ENCRYPTION_KEY is not configured')
  return key
}

/** Signed state for OAuth redirect — binds install to a workspace account. */
export function signShopifyOAuthState(accountId: string): string {
  const sig = crypto
    .createHmac('sha256', stateSecret())
    .update(accountId)
    .digest('hex')
    .slice(0, 16)
  return `${accountId}.${sig}`
}

export function verifyShopifyOAuthState(state: string): string | null {
  const dot = state.indexOf('.')
  if (dot <= 0) return null
  const accountId = state.slice(0, dot)
  const sig = state.slice(dot + 1)
  if (!accountId || !sig) return null
  const expected = crypto
    .createHmac('sha256', stateSecret())
    .update(accountId)
    .digest('hex')
    .slice(0, 16)
  return sig === expected ? accountId : null
}
