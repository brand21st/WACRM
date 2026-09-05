import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { htmlToText } from '@/lib/shopify/html-to-text'
import { extractHttpUrl } from './scrape-url'
import { AiError } from './types'

export { extractHttpUrl } from './scrape-url'

export const SCRAPE_PAGE_CAP_SITE = 15
export const SCRAPE_PAGE_CAP_PAGE = 6
export const SCRAPE_DEPTH_SITE = 2
export const SCRAPE_DEPTH_PAGE = 1
export const SCRAPE_MIN_BODY = 40
export const SCRAPE_BODY_MAX = 20_000
export const SCRAPE_FETCH_TIMEOUT_MS = 15_000
export const SCRAPE_BODY_BYTES_MAX = 1_500_000

export type ScrapeMode = 'page' | 'site'

export interface PendingPage {
  url: string
  depth: number
}

export interface ScrapedPage {
  url: string
  title: string
  content: string
  links: string[]
}

const PRIORITY_PATH =
  /\/(products?|collections?|blogs?|pages?|policies?)\b|\/(faq|faqs|about|about-us|contact|contact-us|shipping|returns|refunds?|privacy|terms)(\/|$)/i

const SKIP_PATH =
  /\/(cart|checkout|account|login|signin|signup|register|search|wishlist|admin|cdn)(\/|$)/i

const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|woff2?|ico)(\?|$)/i

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  'metadata.goog',
])

export function parsePublicHttpUrl(raw: string): URL {
  const extracted = extractHttpUrl(raw)
  if (!extracted) {
    throw new AiError('Paste a full http or https link.', {
      code: 'invalid_url',
      status: 400,
    })
  }
  let url: URL
  try {
    url = new URL(extracted)
  } catch {
    throw new AiError('Paste a full http or https link.', {
      code: 'invalid_url',
      status: 400,
    })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('Only http and https links can be learned.', {
      code: 'invalid_url',
      status: 400,
    })
  }
  if (isBlockedHostname(url.hostname)) {
    throw new AiError('That link cannot be scraped.', {
      code: 'blocked_url',
      status: 400,
    })
  }
  return url
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (!host) return true
  if (BLOCKED_HOSTS.has(host)) return true
  if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    return true
  }
  return isPrivateIp(host)
}

export function isPrivateIp(address: string): boolean {
  const ip = address.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (ip === '::1' || ip === '0:0:0:0:0:0:0:1') return true
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true
  const v4mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  const v4 = v4mapped?.[1] ?? (isIP(ip) === 4 ? ip : null)
  if (!v4) return isIP(ip) === 6 && (ip === '::' || ip.startsWith('::'))
  const parts = v4.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false
  const [a, b] = parts
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export async function assertSafeFetchUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiError('Only http and https links can be learned.', {
      code: 'invalid_url',
      status: 400,
    })
  }
  if (isBlockedHostname(url.hostname)) {
    throw new AiError('That link cannot be scraped.', {
      code: 'blocked_url',
      status: 400,
    })
  }
  try {
    const answers = await lookup(url.hostname, { all: true, verbatim: true })
    for (const row of answers) {
      if (isPrivateIp(row.address)) {
        throw new AiError('That link cannot be scraped.', {
          code: 'blocked_url',
          status: 400,
        })
      }
    }
  } catch (err) {
    if (err instanceof AiError) throw err
    throw new AiError('Could not resolve that link.', {
      code: 'dns_failed',
      status: 400,
    })
  }
}

export function canonicalizeUrl(url: URL): string {
  const copy = new URL(url.href)
  copy.hash = ''
  copy.hostname = copy.hostname.toLowerCase()
  if (copy.pathname !== '/' && copy.pathname.endsWith('/')) {
    copy.pathname = copy.pathname.replace(/\/+$/, '')
  }
  return copy.href
}

export function isHomepageUrl(url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return true
  const segments = path.split('/').filter(Boolean)
  if (segments.length === 1) {
    return /^(en|es|fr|de|pt|it|ar|hi|ko|ja|zh|nl|shop|store|home)$/i.test(segments[0])
  }
  return false
}

export function scrapeModeForUrl(url: URL): ScrapeMode {
  return isHomepageUrl(url) ? 'site' : 'page'
}

export function pageLimitForMode(mode: ScrapeMode): number {
  return mode === 'site' ? SCRAPE_PAGE_CAP_SITE : SCRAPE_PAGE_CAP_PAGE
}

export function depthLimitForMode(mode: ScrapeMode): number {
  return mode === 'site' ? SCRAPE_DEPTH_SITE : SCRAPE_DEPTH_PAGE
}

export function extractPageTitle(html: string): string {
  const og = html.match(
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
  )
  if (og?.[1]) return decodeEntities(og[1]).trim()
  const ogFlip = html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
  )
  if (ogFlip?.[1]) return decodeEntities(ogFlip[1]).trim()
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (title?.[1]) return decodeEntities(title[1].replace(/\s+/g, ' ')).trim()
  return ''
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
}

export function sameHost(a: URL, b: URL): boolean {
  const ha = a.hostname.replace(/^www\./i, '').toLowerCase()
  const hb = b.hostname.replace(/^www\./i, '').toLowerCase()
  return ha === hb
}

export function extractSameHostLinks(html: string, pageUrl: URL): string[] {
  const found = new Set<string>()
  const re = /<a\b[^>]*\bhref=["']([^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const href = match[1].trim()
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      continue
    }
    let next: URL
    try {
      next = new URL(href, pageUrl)
    } catch {
      continue
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') continue
    if (!sameHost(next, pageUrl)) continue
    if (isBlockedHostname(next.hostname)) continue
    if (SKIP_PATH.test(next.pathname) || SKIP_EXT.test(next.pathname)) continue
    found.add(canonicalizeUrl(next))
  }
  return [...found]
}

export function prioritizeKnowledgeLinks(urls: string[]): string[] {
  return [...urls].sort((a, b) => scorePath(a) - scorePath(b))
}

function scorePath(raw: string): number {
  try {
    const path = new URL(raw).pathname
    if (PRIORITY_PATH.test(path)) return 0
    return 1
  } catch {
    return 2
  }
}

export function pickFollowLinks(
  html: string,
  pageUrl: URL,
  remaining: number,
): string[] {
  if (remaining <= 0) return []
  const links = prioritizeKnowledgeLinks(extractSameHostLinks(html, pageUrl))
  return links.slice(0, remaining)
}

export async function fetchScrapedPage(rawUrl: string): Promise<ScrapedPage> {
  const start = parsePublicHttpUrl(rawUrl)
  const html = await fetchHtmlFollowingRedirects(start)
  const url = canonicalizeUrl(start)
  const title = extractPageTitle(html) || fallbackTitle(start)
  const content = htmlToText(html, SCRAPE_BODY_MAX)
  if (content.length < SCRAPE_MIN_BODY) {
    throw new AiError('That page did not have enough readable text.', {
      code: 'empty_page',
      status: 422,
    })
  }
  return {
    url,
    title,
    content,
    links: extractSameHostLinks(html, start),
  }
}

function fallbackTitle(url: URL): string {
  const path = url.pathname.replace(/\/+$/, '')
  const last = path.split('/').filter(Boolean).pop()
  if (last) return decodeURIComponent(last.replace(/[-_]+/g, ' '))
  return url.hostname
}

async function fetchHtmlFollowingRedirects(start: URL): Promise<string> {
  let current = start
  for (let hop = 0; hop < 5; hop++) {
    await assertSafeFetchUrl(current)
    const res = await fetch(current.href, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'waCRM-knowledge-scrape/1.0',
      },
      signal: AbortSignal.timeout(SCRAPE_FETCH_TIMEOUT_MS),
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location')
      if (!location) {
        throw new AiError('Could not read that page.', {
          code: 'fetch_failed',
          status: 502,
        })
      }
      current = new URL(location, current)
      continue
    }
    if (!res.ok) {
      throw new AiError(`Could not read that page (${res.status}).`, {
        code: 'fetch_failed',
        status: 502,
      })
    }
    const length = Number(res.headers.get('content-length') ?? 0)
    if (length > SCRAPE_BODY_BYTES_MAX) {
      throw new AiError('That page is too large to learn from.', {
        code: 'too_large',
        status: 413,
      })
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > SCRAPE_BODY_BYTES_MAX) {
      throw new AiError('That page is too large to learn from.', {
        code: 'too_large',
        status: 413,
      })
    }
    return buf.toString('utf8')
  }
  throw new AiError('That link redirected too many times.', {
    code: 'too_many_redirects',
    status: 400,
  })
}
