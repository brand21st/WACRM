import crypto from 'crypto'

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/**
 * Verify Shopify OAuth redirect query HMAC (hex digest).
 * @see https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/authorization-code-grant
 */
export function verifyShopifyOAuthHmac(
  params: URLSearchParams,
  clientSecret: string,
): boolean {
  const hmac = params.get('hmac')
  if (!hmac) return false

  const pairs: string[] = []
  for (const [key, value] of params.entries()) {
    if (key === 'hmac' || key === 'signature') continue
    pairs.push(`${key}=${value}`)
  }
  pairs.sort()
  const message = pairs.join('&')
  const digest = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex')
  return timingSafeEqual(digest, hmac)
}

/**
 * Verify Shopify webhook HMAC (base64 header vs raw body).
 */
export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  clientSecret: string,
): boolean {
  if (!hmacHeader) return false
  const digest = crypto
    .createHmac('sha256', clientSecret)
    .update(rawBody, 'utf8')
    .digest('base64')
  return timingSafeEqual(digest, hmacHeader)
}
