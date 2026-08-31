import {
  INDIC_CURRENCY_WORDS,
  detectIndicLanguage,
  isIndicScript,
} from '@/lib/ai/indic-language'

/** Bracketed Eleven v3 direction — not spoken as words. */
const AUDIO_TAG = /\[[A-Za-z][A-Za-z\s]*\]/
const APOLOGY_EN = /\b(?:sorry|apologize|apologise)\b/i
const APOLOGY_INDIC = /ക്ഷമിക്കണം|माफ|माफ़/

const INDIC_CURRENCY_PAUSE = new RegExp(
  `(?:${Object.values(INDIC_CURRENCY_WORDS)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})`,
  'g',
)

/**
 * Shape reply text for ElevenLabs TTS only. Inbox captions keep the
 * original digits; this just makes numbers and symbols speakable.
 */
export function prepareSpeechText(raw: string): string {
  return enhanceSpeechText(normalizeSpeechText(raw))
}

function expandIndicRupee(text: string): string {
  const lang = detectIndicLanguage(text)
  const currency = lang ? INDIC_CURRENCY_WORDS[lang.elevenlabs] : null
  if (!currency) return text
  let out = text
  out = out.replace(/₹\s*(\d+(?:[.,]\d+)?)/g, `$1 ${currency}`)
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*₹/g, `$1 ${currency}`)
  out = out.replace(/₹/g, ` ${currency} `)
  return out.replace(/\s+/g, ' ').trim()
}

function normalizeSpeechText(raw: string): string {
  let text = raw.trim()
  if (!text) return ''

  // Bold before italic so ** is not treated as two italics.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')
  text = text.replace(/\*+/g, '')
  // Markdown headings only — leave `#123456` order ids intact.
  text = text.replace(/^#{1,6}\s+/gm, '')

  if (isIndicScript(text)) {
    text = expandIndicRupee(text)
  } else {
    text = text.replace(/₹/g, ' rupees ')
    text = text.replace(/\$/g, ' dollars ')
  }

  // Phones, OTPs, order ids — digit-by-digit. Short amounts stay
  // intact so ElevenLabs can say "four hundred ninety-nine".
  text = text.replace(/\d{6,}/g, (digits) => digits.split('').join(' '))

  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Eleven v3 Audio Tags for delivery. CRM-safe: warmly/friendly/softly +
 * pauses before money and long ids. Never shouting or SFX.
 */
export function enhanceSpeechText(raw: string): string {
  let text = raw.trim()
  if (!text) return ''

  const hasTags = AUDIO_TAG.test(text)
  const indic = isIndicScript(text)

  text = insertPauseBefore(text, /\b(?:rupees|dollars)\b/gi)
  if (indic) text = insertPauseBefore(text, INDIC_CURRENCY_PAUSE)
  text = insertPauseBefore(text, /\d(?: \d){5,}/g)

  if (!hasTags) {
    const sorry = APOLOGY_EN.test(text) || APOLOGY_INDIC.test(text)
    const tag = sorry ? '[softly]' : indic ? '[warmly]' : '[friendly]'
    text = `${tag} ${text}`
  }

  return text.replace(/\s+/g, ' ').trim()
}

function insertPauseBefore(text: string, pattern: RegExp): string {
  return text.replace(pattern, (match, offset: number) => {
    const before = text.slice(Math.max(0, offset - 16), offset)
    if (/\[pause\]\s*$/i.test(before)) return match
    return `[pause] ${match}`
  })
}
