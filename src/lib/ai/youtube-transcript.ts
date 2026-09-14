import {
  assertSafeFetchUrl,
  canonicalizeUrl,
  decodeEntities,
  parsePublicHttpUrl,
  SCRAPE_BROWSER_UA,
  SCRAPE_FETCH_TIMEOUT_MS,
} from './scrape'
import {
  canonicalYoutubeWatchUrl,
  isYoutubeListUrl,
  parseYoutubeVideoId,
} from './scrape-url'
import { AiError } from './types'

export const YOUTUBE_TRANSCRIPT_MAX = 100_000

export { parseYoutubeVideoId, isYoutubeListUrl, canonicalYoutubeWatchUrl }

interface CaptionTrack {
  baseUrl?: string
  languageCode?: string
  kind?: string
  name?: { simpleText?: string }
}

interface PlayerResponse {
  videoDetails?: {
    title?: string
    shortDescription?: string
  }
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[]
    }
  }
}

export function extractJsonAssignment(html: string, name: string): unknown {
  const needle = `${name} = `
  const idx = html.indexOf(needle)
  if (idx < 0) return null
  const start = html.indexOf('{', idx)
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < html.length; i++) {
    const ch = html[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export function timedtextToPlain(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as {
        events?: { segs?: { utf8?: string }[] }[]
      }
      const parts: string[] = []
      for (const event of data.events ?? []) {
        const line = (event.segs ?? [])
          .map((s) => s.utf8 ?? '')
          .join('')
          .replace(/\n+/g, ' ')
          .trim()
        if (line) parts.push(line)
      }
      return parts.join('\n').trim()
    } catch {
      /* fall through to XML */
    }
  }
  const texts = [...trimmed.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/gi)]
  if (texts.length === 0) return htmlishToText(trimmed)
  return texts
    .map((m) => htmlishToText(m[1] ?? ''))
    .filter(Boolean)
    .join('\n')
}

function htmlishToText(value: string): string {
  return decodeEntities(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

export function pickCaptionTrack(
  tracks: CaptionTrack[],
  preferredLanguage?: string | null,
): CaptionTrack | null {
  if (tracks.length === 0) return null
  const pref = preferredLanguage?.trim().toLowerCase()
  if (pref) {
    const exact = tracks.find((t) => t.languageCode?.toLowerCase() === pref)
    if (exact?.baseUrl) return exact
    const prefix = tracks.find((t) =>
      t.languageCode?.toLowerCase().startsWith(pref.split('-')[0] ?? pref),
    )
    if (prefix?.baseUrl) return prefix
  }
  const manual = tracks.find((t) => t.kind !== 'asr' && t.baseUrl)
  if (manual) return manual
  return tracks.find((t) => t.baseUrl) ?? null
}

export function buildYoutubeDocumentBody(args: {
  title: string
  description?: string
  transcript: string
}): string {
  const title = args.title.trim()
  const description = args.description?.trim() ?? ''
  const transcript = args.transcript.trim()
  const parts = [
    title,
    description && description !== title ? description : '',
    transcript,
  ].filter(Boolean)
  let body = parts.join('\n\n')
  if (body.length > YOUTUBE_TRANSCRIPT_MAX) {
    body = `${body.slice(0, YOUTUBE_TRANSCRIPT_MAX - 1)}…`
  }
  return body
}

export async function fetchYoutubeKnowledgePage(
  rawUrl: string,
  opts?: { preferredLanguage?: string | null },
): Promise<{ url: string; title: string; content: string; links: string[] }> {
  if (isYoutubeListUrl(rawUrl) && !parseYoutubeVideoId(rawUrl)) {
    throw new AiError('Paste a single YouTube video, not a playlist or channel.', {
      code: 'youtube_list',
      status: 400,
    })
  }
  const videoId = parseYoutubeVideoId(rawUrl)
  if (!videoId) {
    throw new AiError('Paste a single YouTube video, not a playlist or channel.', {
      code: 'youtube_list',
      status: 400,
    })
  }
  const watch = canonicalYoutubeWatchUrl(videoId)
  const start = parsePublicHttpUrl(watch)
  await assertSafeFetchUrl(start)
  const html = await fetchYoutubeText(start.href)
  const player = extractJsonAssignment(html, 'ytInitialPlayerResponse') as
    | PlayerResponse
    | null
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  const track = pickCaptionTrack(tracks, opts?.preferredLanguage)
  if (!track?.baseUrl) {
    throw new AiError('This YouTube video has no captions to learn from.', {
      code: 'youtube_no_captions',
      status: 422,
    })
  }
  const captionUrl = withJson3(track.baseUrl)
  const captionHost = new URL(captionUrl)
  const captionHostName = captionHost.hostname.replace(/^www\./i, '').toLowerCase()
  if (
    captionHostName !== 'youtube.com' &&
    !captionHostName.endsWith('.youtube.com') &&
    captionHostName !== 'youtu.be'
  ) {
    throw new AiError('This YouTube video has no captions to learn from.', {
      code: 'youtube_no_captions',
      status: 422,
    })
  }
  await assertSafeFetchUrl(captionHost)
  const timedtext = await fetchYoutubeText(captionUrl)
  const transcript = timedtextToPlain(timedtext)
  if (transcript.length < 40) {
    throw new AiError('This YouTube video has no captions to learn from.', {
      code: 'youtube_no_captions',
      status: 422,
    })
  }
  const oembedTitle = await fetchOembedTitle(watch)
  const title =
    oembedTitle ||
    player?.videoDetails?.title?.trim() ||
    `YouTube ${videoId}`
  const description = player?.videoDetails?.shortDescription ?? ''
  return {
    url: canonicalizeUrl(start),
    title,
    content: buildYoutubeDocumentBody({ title, description, transcript }),
    links: [],
  }
}

function withJson3(baseUrl: string): string {
  const url = new URL(baseUrl)
  if (!url.searchParams.has('fmt')) url.searchParams.set('fmt', 'json3')
  return url.href
}

async function fetchOembedTitle(watchUrl: string): Promise<string> {
  try {
    const oembed = new URL('https://www.youtube.com/oembed')
    oembed.searchParams.set('url', watchUrl)
    oembed.searchParams.set('format', 'json')
    await assertSafeFetchUrl(oembed)
    const res = await fetch(oembed.href, {
      headers: { Accept: 'application/json', 'User-Agent': SCRAPE_BROWSER_UA },
      signal: AbortSignal.timeout(SCRAPE_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return ''
    const data = (await res.json()) as { title?: string }
    return typeof data.title === 'string' ? data.title.trim() : ''
  } catch {
    return ''
  }
}

async function fetchYoutubeText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/json,application/xml,*/*',
      'User-Agent': SCRAPE_BROWSER_UA,
    },
    signal: AbortSignal.timeout(SCRAPE_FETCH_TIMEOUT_MS),
    redirect: 'follow',
  })
  if (!res.ok) {
    throw new AiError(`Could not read that page (${res.status}).`, {
      code: 'fetch_failed',
      status: 502,
    })
  }
  return res.text()
}
