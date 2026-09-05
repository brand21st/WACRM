/**
 * URL helpers shared by the Settings knowledge-base panel (browser)
 * and the server scrape pipeline. Keep this file free of Node-only
 * imports so the client bundle can detect a pasted link.
 */

export function extractHttpUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const whole = trimmed.match(/^https?:\/\/\S+$/i)
  if (whole) return stripTrailingPunctuation(whole[0])
  const embedded = trimmed.match(/https?:\/\/[^\s<>"'）】]+/i)
  return embedded ? stripTrailingPunctuation(embedded[0]) : null
}

function stripTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)]+$/, '')
}
