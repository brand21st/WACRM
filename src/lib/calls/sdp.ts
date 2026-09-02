/**
 * Chromium's SDP parser requires RFC 4566 line endings: each record
 * ends with CRLF, including the last line. Meta's Calling webhook and
 * JSON/Postgres round-trips often leave LF-only, a dangling CR, or
 * JSON-escaped `\\n` — all of which surface as
 * `Failed to parse SessionDescription. a=rtpmap:… Invalid SDP line.`
 */
export function normalizeOfferSdp(raw: string): string {
  let s = raw.trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1)
  }

  if (!/[\r\n]/.test(s) && /\\[rn]/.test(s)) {
    s = s.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\\r/g, '\n')
  }

  const lines = s
    .split(/\r\n|\n|\r/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)

  if (lines.length === 0) return ''
  return `${lines.join('\r\n')}\r\n`
}
