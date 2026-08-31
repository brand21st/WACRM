import { ShopifyError } from './client'

/**
 * Exchange Partner app Client ID + API secret (shpss_) for a short-lived
 * Admin API access token via the client credentials grant.
 *
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens#client-credentials-grant
 */
export async function exchangeClientCredentials(args: {
  shopDomain: string
  clientId: string
  clientSecret: string
  fetchImpl?: typeof fetch
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = `https://${args.shopDomain}/admin/oauth/access_token`
  const fetchImpl = args.fetchImpl ?? fetch

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ShopifyError(`Could not reach Shopify OAuth: ${msg}`, 504, 'shopify_timeout')
  }

  const rawText = await res.text().catch(() => '')
  let body: {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  } | null = null
  try {
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const detail =
      body?.error_description ||
      body?.error ||
      (rawText.includes('application_cannot_be_found')
        ? 'Shopify app not installed on this store (application_cannot_be_found). Install the app on the store, or use a custom-app Admin API token (shpat_…).'
        : rawText.slice(0, 200))
    throw new ShopifyError(
      detail
        ? `Shopify OAuth error (${res.status}): ${detail}`
        : `Shopify OAuth error (${res.status})`,
      res.status === 401 || res.status === 403 ? 401 : 502,
      'invalid_token',
    )
  }

  if (!body?.access_token) {
    throw new ShopifyError('Shopify OAuth returned no access_token.')
  }

  return { accessToken: body.access_token, expiresIn: body.expires_in }
}

/**
 * Exchange an authorization code from the OAuth install redirect for an
 * Admin API access token.
 */
export async function exchangeAuthorizationCode(args: {
  shopDomain: string
  clientId: string
  clientSecret: string
  code: string
  fetchImpl?: typeof fetch
}): Promise<{ accessToken: string }> {
  const url = `https://${args.shopDomain}/admin/oauth/access_token`
  const fetchImpl = args.fetchImpl ?? fetch

  let res: Response
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: args.clientId,
        client_secret: args.clientSecret,
        code: args.code.trim(),
      }),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new ShopifyError(`Could not reach Shopify OAuth: ${msg}`, 504, 'shopify_timeout')
  }

  const rawText = await res.text().catch(() => '')
  let body: {
    access_token?: string
    error?: string
    error_description?: string
  } | null = null
  try {
    body = rawText ? JSON.parse(rawText) : null
  } catch {
    body = null
  }

  if (!res.ok) {
    const detail =
      body?.error_description ||
      body?.error ||
      rawText.slice(0, 200)
    throw new ShopifyError(
      detail
        ? `Shopify OAuth error (${res.status}): ${detail}`
        : `Shopify OAuth error (${res.status})`,
      res.status === 401 || res.status === 403 ? 401 : 502,
      'invalid_token',
    )
  }

  if (!body?.access_token) {
    throw new ShopifyError('Shopify OAuth returned no access_token.')
  }

  return { accessToken: body.access_token }
}

/** True when the stored credential is an API secret (OAuth), not a direct Admin token. */
export function isApiSecretKey(value: string): boolean {
  return value.trim().startsWith('shpss_')
}

/**
 * Resolve a credential to an Admin API access token for GraphQL calls.
 * Direct `shpat_` tokens pass through; `shpss_` secrets are exchanged.
 */
export async function resolveAdminAccessToken(args: {
  shopDomain: string
  clientId: string | null | undefined
  credential: string
  fetchImpl?: typeof fetch
}): Promise<string> {
  const credential = args.credential.trim()
  if (!isApiSecretKey(credential)) return credential

  const clientId = args.clientId?.trim()
  if (!clientId) {
    throw new ShopifyError(
      'Client ID is required when using the API secret key (shpss_…). ' +
        'Fill Client ID in Shopify settings and save again.',
      400,
      'invalid_token',
    )
  }

  const { accessToken } = await exchangeClientCredentials({
    shopDomain: args.shopDomain,
    clientId,
    clientSecret: credential,
    fetchImpl: args.fetchImpl,
  })
  return accessToken
}
