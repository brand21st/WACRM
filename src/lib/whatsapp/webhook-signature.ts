import crypto from 'node:crypto'

/**
 * Verify the HMAC-SHA256 signature Meta attaches to webhook POSTs.
 *
 * Meta signs the raw request body with your App Secret and sends the
 * result in the `x-hub-signature-256: sha256=<hex>` header. Without
 * verification, anyone who knows our webhook URL can POST fabricated
 * status updates and drift broadcast counts arbitrarily.
 *
 * Reference:
 *   https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verify-payloads
 *
 * Contract:
 *   `META_APP_SECRET` is **required**. If it's missing we fail closed —
 *   every request is rejected until the operator configures the
 *   secret. A previous version fell open with a warning log, which is
 *   unsafe for a public template: anyone who forgets the env var would
 *   be running a fully spoofable webhook.
 */
function signatureMatchesSecret(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', secret).update(rawBody).digest('hex')

  const a = Buffer.from(signatureHeader)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/**
 * Verify an inbound Meta webhook HMAC. Tries the platform
 * `META_APP_SECRET` and any additional tenant secrets passed in
 * (bring-your-own-app clients each sign with their own App Secret).
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secrets?: string[],
): boolean {
  const candidates =
    secrets?.length
      ? secrets
      : process.env.META_APP_SECRET
        ? [process.env.META_APP_SECRET]
        : []

  if (!candidates.length) {
    console.error(
      '[webhook] No Meta App Secret configured — rejecting request. ' +
        'Set META_APP_SECRET (platform app) or save a per-tenant App Secret ' +
        'in WhatsApp settings for bring-your-own-app clients.',
    )
    return false
  }

  if (!signatureHeader) return false
  if (!signatureHeader.startsWith('sha256=')) return false

  return candidates.some((secret) =>
    signatureMatchesSecret(rawBody, signatureHeader, secret),
  )
}
