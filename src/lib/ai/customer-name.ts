/**
 * First token of a CRM / WhatsApp display name, safe to speak and
 * put in a prompt. Drops empties, single letters, and phone-like values.
 */
export function speakableFirstName(
  raw: string | null | undefined,
): string | null {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return null

  const first = trimmed.split(/\s+/)[0] ?? ''
  const token = first.replace(/[.,;:!?]+$/u, '')
  if (token.length < 2) return null
  if (/^\+?\d[\d\s-()]{5,}$/.test(token) || /^\d+$/.test(token)) return null

  if (/^[A-Za-z]+$/.test(token) && token === token.toUpperCase()) {
    return token[0] + token.slice(1).toLowerCase()
  }
  return token
}
