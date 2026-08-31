import {
  INDIC_CURRENCY_WORDS,
  detectIndicLanguage,
} from './indic-language'

/** Markdown `[label](url)` — keep the label, drop the URL. */
const MARKDOWN_LINK = /\[([^\]]+)\]\(\s*<?(?:https?:\/\/|www\.)[^)\s>]+>?\s*\)/gi

/** http(s) and www. links, including a trailing slash/query. */
const BARE_URL = /(?:https?:\/\/|www\.)[^\s<>[\]()]+/gi

/** "View:" / "Buy:" / "Buy now:" left behind after the URL is gone. */
const ORPHAN_LINK_LABEL = /\b(?:View|Buy(?:\s+now)?)\s*:\s*(?=\s|$|[.,;!?])/gi

/**
 * Text that is safe to send to TTS. Website links stay in the WhatsApp
 * text bubble / voice-note caption; they must not be read aloud.
 *
 * Returns `''` when nothing speakable remains (auto-reply then skips
 * TTS and falls back to text).
 */
export function stripUrlsForSpeech(text: string): string {
  let out = text.replace(MARKDOWN_LINK, '$1')
  out = out.replace(BARE_URL, (match) => {
    const trimmed = match.replace(/[.,;:!?]+$/u, '')
    return match.slice(trimmed.length)
  })
  out = out.replace(ORPHAN_LINK_LABEL, '')
  out = out.replace(/[ \t]+\n/g, '\n')
  out = out.replace(/\n{3,}/g, '\n\n')
  out = out.replace(/[ \t]{2,}/g, ' ')
  return out.trim()
}

/** ALL-CAPS catalog slug: `POURNAMI RED:PREMIUM COTTON SAREE`. */
const ALL_CAPS_SLUG =
  /\b[A-Z]{2,}(?:\s*[:/-]\s*[A-Z]{2,}|\s+[A-Z]{2,})+\b/g

function titleCaseAllCapsSlugs(text: string): string {
  return text.replace(ALL_CAPS_SLUG, (slug) =>
    slug
      .replace(/\s*:\s*/g, ', ')
      .replace(/\s*[/ -]\s*/g, ' ')
      .replace(/[A-Z]{2,}/g, (word) => word[0] + word.slice(1).toLowerCase()),
  )
}

function expandCurrencySymbols(text: string, currency: string): string {
  let out = text
  out = out.replace(/₹\s*(\d+(?:[.,]\d+)?)/g, `$1 ${currency}`)
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*₹/g, `$1 ${currency}`)
  out = out.replace(/\b(?:Rs\.?|INR)\s*(\d+(?:[.,]\d+)?)/gi, `$1 ${currency}`)
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*(?:Rs\.?|INR)\b/gi, `$1 ${currency}`)
  out = out.replace(/₹/g, ` ${currency} `)
  out = out.replace(/\b(?:Rs\.?|INR)\b/gi, currency)
  return out.replace(/\s+/g, ' ').trim()
}

function pauseBeforePrice(text: string, currency: string): string {
  const escaped = currency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(
    new RegExp(`([^\\s,])\\s+(\\d{2,5})\\s+(${escaped})`, 'g'),
    '$1, $2 $3',
  )
}

/**
 * Speech-only Indic pronunciation prep. WhatsApp text stays original.
 * Expands leftover rupee symbols, title-cases ALL-CAPS catalog slugs,
 * and pauses between a product name and a price.
 * `languageHint` (ISO 639-1 from the customer turn) expands ₹ / Rs in
 * Latin Manglish when script detection would miss the language.
 */
export function prepareIndicSpeechText(
  text: string,
  languageHint?: string | null,
): string {
  let out = text.trim()
  if (!out) return ''

  out = titleCaseAllCapsSlugs(out)

  const lang = detectIndicLanguage(out)
  const hint = languageHint?.trim() || ''
  const currency =
    (lang ? INDIC_CURRENCY_WORDS[lang.elevenlabs] : null) ??
    (hint ? INDIC_CURRENCY_WORDS[hint] : null) ??
    null
  if (currency) {
    out = expandCurrencySymbols(out, currency)
    out = pauseBeforePrice(out, currency)
  }

  out = out.replace(/\d{6,}/g, (digits) => digits.split('').join(' '))
  return out.replace(/\s+/g, ' ').trim()
}
