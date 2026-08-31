/**
 * Catch common credential mix-ups before calling Shopify.
 */
export function adminAccessTokenHint(token: string, clientId?: string | null): string | null {
  const t = token.trim()
  if (t.startsWith('shpss_') && !clientId?.trim()) {
    return (
      'API secret (shpss_…) requires the Client ID in the Client ID field. ' +
      'WACRM exchanges Client ID + secret for an access token per Shopify OAuth.'
    )
  }
  if (/^[a-f0-9]{32}$/i.test(t)) {
    return (
      'That looks like the Client ID / API key. Put it in Client ID, and paste ' +
      'the Admin API access token (shpat_…) or API secret (shpss_…) in the token field.'
    )
  }
  return null
}
