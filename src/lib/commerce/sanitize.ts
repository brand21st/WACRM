const CONTROL = /[\u0000-\u001f\u007f]/g

/** Strip control chars and cap length. Never treat webhook strings as fetch URLs. */
export function sanitizeWebhookText(raw: unknown, max = 200): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(CONTROL, '').trim().slice(0, max)
}

export function sanitizeReferenceId(raw: unknown): string {
  const value = sanitizeWebhookText(raw, 35)
  if (!/^[A-Za-z0-9._-]+$/.test(value)) return ''
  return value
}

/** Drop javascript:/data: and non-https URLs so webhook payloads cannot be used for SSRF. */
export function sanitizeHttpsUrl(raw: unknown): string | null {
  const value = sanitizeWebhookText(raw, 2048)
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    const host = url.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host.endsWith('.local') ||
      host === '0.0.0.0' ||
      host.startsWith('127.') ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}
