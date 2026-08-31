/**
 * Normalize a merchant-typed shop to `{subdomain}.myshopify.com`.
 * Accepts a subdomain, full myshopify host, or URL.
 */
export function normalizeShopDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase()
  if (!s) return null
  s = s.replace(/^https?:\/\//, '')
  const slash = s.indexOf('/')
  if (slash !== -1) s = s.slice(0, slash)
  s = s.replace(/\.$/, '')

  if (s.endsWith('.myshopify.com')) {
    const sub = s.slice(0, -'.myshopify.com'.length)
    return isShopSubdomain(sub) ? `${sub}.myshopify.com` : null
  }
  return isShopSubdomain(s) ? `${s}.myshopify.com` : null
}

function isShopSubdomain(sub: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/.test(sub) || /^[a-z0-9]$/.test(sub)
}

/** Origin used for product / cart permalinks. */
export function storefrontOrigin(primaryDomain: string | null | undefined): string {
  const raw = (primaryDomain || '').trim()
  if (!raw) return ''
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\/+$/, '')
  }
  return `https://${raw.replace(/\/+$/, '')}`
}
