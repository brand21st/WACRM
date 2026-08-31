const BLOCK_BREAK =
  /<\/(p|div|h[1-6]|li|tr|section|article|blockquote|figcaption)>/gi

/**
 * Convert Shopify HTML (policies, pages, product descriptions) to
 * plain text suitable for FTS and the AI system prompt.
 */
export function htmlToText(raw: string, max = 20_000): string {
  if (!raw) return ''
  let t = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_BREAK, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => {
      const code = Number(n)
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : ' '
    })
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (t.length > max) t = `${t.slice(0, max - 1)}…`
  return t
}

/** Return inner HTML of the first element whose class list includes `className`. */
export function extractHtmlByClass(html: string, className: string): string | null {
  const needle = className.toLowerCase()
  const re = /<div\b[^>]*class=["']([^"']*)["'][^>]*>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const classes = match[1].toLowerCase().split(/\s+/)
    if (!classes.includes(needle)) continue
    const start = match.index + match[0].length
    const inner = sliceUntilDivCloses(html, start)
    return inner || null
  }
  return null
}

function sliceUntilDivCloses(html: string, start: number): string {
  let depth = 1
  const tag = /<\/?div\b[^>]*>/gi
  tag.lastIndex = start
  let match: RegExpExecArray | null
  while ((match = tag.exec(html))) {
    const isClose = match[0].startsWith('</')
    const isSelf = /\/\s*>$/.test(match[0])
    if (isSelf) continue
    depth += isClose ? -1 : 1
    if (depth === 0) return html.slice(start, match.index)
  }
  return html.slice(start, start + 80_000)
}
