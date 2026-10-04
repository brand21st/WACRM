const PRIVATE_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  const a = Number(m[1])
  const b = Number(m[2])
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

/**
 * Shape check for a stored PostBus API base URL. Rejects empty,
 * non-HTTPS, localhost, and literal private IPs. Does not DNS-resolve
 * (that belongs to a later remote health check).
 */
export function parsePostBusApiBaseUrl(
  raw: unknown,
): { ok: true; url: string } | { ok: false; error: string } {
  if (raw == null || raw === '') {
    return { ok: true, url: '' }
  }
  if (typeof raw !== 'string') {
    return { ok: false, error: 'api_base_url must be a string' }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { ok: true, url: '' }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return { ok: false, error: 'api_base_url is not a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'api_base_url must use HTTPS' }
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const isIpv6Literal = host.includes(':')
  if (
    PRIVATE_HOSTS.has(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isPrivateIpv4(host) ||
    (isIpv6Literal &&
      (host === '::1' ||
        host.startsWith('fc') ||
        host.startsWith('fd') ||
        host.startsWith('fe8') ||
        host.startsWith('fe9') ||
        host.startsWith('fea') ||
        host.startsWith('feb')))
  ) {
    return { ok: false, error: 'api_base_url must be a public hostname' }
  }

  const normalized = parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/$/, ''))
  return { ok: true, url: normalized }
}
