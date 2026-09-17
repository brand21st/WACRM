/**
 * Postgres rejects JSON (and PostgREST payloads) that contain unpaired
 * UTF-16 surrogates. Shopify product copy/emoji sometimes arrives that way,
 * and a single bad character used to abort the whole catalog snapshot insert.
 */
export function jsonSafeText(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = raw.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += raw[i] + raw[i + 1]
        i += 1
        continue
      }
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue
    out += raw[i]
  }
  return out
}

export function jsonSafeValue<T>(value: T): T {
  if (typeof value === 'string') return jsonSafeText(value) as T
  if (Array.isArray(value)) return value.map((item) => jsonSafeValue(item)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = jsonSafeValue(nested)
    }
    return out as T
  }
  return value
}
