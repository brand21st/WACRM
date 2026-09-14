/**
 * URL helpers shared by the Settings knowledge-base panel (browser)
 * and the server scrape pipeline. Keep this file free of Node-only
 * imports so the client bundle can detect a pasted link.
 */

const YOUTUBE_HOST =
  /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i
const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_LIST_PATH =
  /^\/(playlist|channel|c|user|@)(\/|$)/i

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

export function isYoutubeHostname(hostname: string): boolean {
  return YOUTUBE_HOST.test(hostname.trim().toLowerCase())
}

export function isYoutubeUrl(raw: string): boolean {
  const extracted = extractHttpUrl(raw)
  if (!extracted) return false
  try {
    return isYoutubeHostname(new URL(extracted).hostname)
  } catch {
    return false
  }
}

/** True for playlist / channel / @handle URLs with no watchable video id. */
export function isYoutubeListUrl(raw: string): boolean {
  const extracted = extractHttpUrl(raw)
  if (!extracted) return false
  try {
    const url = new URL(extracted)
    if (!isYoutubeHostname(url.hostname)) return false
    if (parseYoutubeVideoId(extracted)) return false
    return YOUTUBE_LIST_PATH.test(url.pathname)
  } catch {
    return false
  }
}

export function parseYoutubeVideoId(raw: string): string | null {
  const extracted = extractHttpUrl(raw)
  if (!extracted) return null
  let url: URL
  try {
    url = new URL(extracted)
  } catch {
    return null
  }
  if (!isYoutubeHostname(url.hostname)) return null
  const host = url.hostname.replace(/^www\./i, '').toLowerCase()
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0] ?? ''
    return YOUTUBE_VIDEO_ID.test(id) ? id : null
  }
  const fromQuery = url.searchParams.get('v')?.trim() ?? ''
  if (YOUTUBE_VIDEO_ID.test(fromQuery)) return fromQuery
  const path = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?:\/|$)/i)
  return path?.[1] ?? null
}

export function canonicalYoutubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}
