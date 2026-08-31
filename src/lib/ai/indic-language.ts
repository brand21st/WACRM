/**
 * Detect Indian-language script (and romanized Manglish / Hinglish /
 * Tanglish cues) so TTS and the spoken rewrite can lock the right
 * Sarvam BCP-47 / ElevenLabs ISO 639-1 code.
 *
 * Script detection stays conservative: Latin-only English returns null.
 * `detectSpokenIndicTarget` also scores romanized shop-counter words.
 */

export interface IndicLanguageCodes {
  /** Sarvam `language_code`, e.g. `ml-IN`. */
  sarvam: string
  /** ElevenLabs ISO 639-1, e.g. `ml`. */
  elevenlabs: string
}

/** Spoken rupee word keyed by ElevenLabs ISO 639-1. */
export const INDIC_CURRENCY_WORDS: Record<string, string> = {
  hi: 'रुपये',
  mr: 'रुपये',
  bn: 'টাকা',
  gu: 'રૂપિયા',
  kn: 'ರೂಪಾಯಿ',
  ml: 'രൂപ',
  or: 'ଟଙ୍କା',
  pa: 'ਰੁਪਏ',
  ta: 'ரூபாய்',
  te: 'రూపాయలు',
}

export const INDIC_LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  kn: 'Kannada',
  ml: 'Malayalam',
  or: 'Odia',
  pa: 'Punjabi',
  ta: 'Tamil',
  te: 'Telugu',
  as: 'Assamese',
  ur: 'Urdu',
}

/** ElevenLabs-only languages (Sarvam has no matching code). */
const URDU: IndicLanguageCodes = { sarvam: '', elevenlabs: 'ur' }
const ASSAMESE: IndicLanguageCodes = { sarvam: '', elevenlabs: 'as' }

const SCRIPT_RANGES: {
  re: RegExp
  codes: IndicLanguageCodes
}[] = [
  { re: /[\u0D00-\u0D7F]/g, codes: { sarvam: 'ml-IN', elevenlabs: 'ml' } },
  { re: /[\u0B80-\u0BFF]/g, codes: { sarvam: 'ta-IN', elevenlabs: 'ta' } },
  { re: /[\u0C00-\u0C7F]/g, codes: { sarvam: 'te-IN', elevenlabs: 'te' } },
  { re: /[\u0C80-\u0CFF]/g, codes: { sarvam: 'kn-IN', elevenlabs: 'kn' } },
  { re: /[\u0A80-\u0AFF]/g, codes: { sarvam: 'gu-IN', elevenlabs: 'gu' } },
  { re: /[\u0A00-\u0A7F]/g, codes: { sarvam: 'pa-IN', elevenlabs: 'pa' } },
  { re: /[\u0600-\u06FF]/g, codes: URDU },
  { re: /[\u0980-\u09FF]/g, codes: { sarvam: 'bn-IN', elevenlabs: 'bn' } },
  { re: /[\u0B00-\u0B7F]/g, codes: { sarvam: 'od-IN', elevenlabs: 'or' } },
  { re: /[\u0900-\u097F]/g, codes: { sarvam: 'hi-IN', elevenlabs: 'hi' } },
]

const MARATHI: IndicLanguageCodes = { sarvam: 'mr-IN', elevenlabs: 'mr' }

/** Distinctive romanized shop-counter cues. Short words need 2 hits. */
const ROMANIZED: { codes: IndicLanguageCodes; cues: string[] }[] = [
  {
    codes: { sarvam: 'ml-IN', elevenlabs: 'ml' },
    cues: [
      'ethra',
      'venam',
      'alle',
      'aano',
      'njan',
      'njn',
      'evide',
      'ippo',
      'ippol',
      'pinne',
      'undo',
      'undu',
      'und',
      'parayu',
      'vangikko',
      'kittum',
      'chechi',
      'chetta',
    ],
  },
  {
    codes: { sarvam: 'hi-IN', elevenlabs: 'hi' },
    cues: [
      'kya',
      'kitna',
      'chahiye',
      'nahi',
      'nahin',
      'kaise',
      'kahan',
      'accha',
      'theek',
      'dikhao',
      'bhejo',
      'hai',
      'hain',
    ],
  },
  {
    codes: { sarvam: 'ta-IN', elevenlabs: 'ta' },
    cues: [
      'iruku',
      'irukku',
      'venum',
      'enna',
      'epdi',
      'inga',
      'theriyum',
      'illa',
    ],
  },
  {
    codes: { sarvam: 'te-IN', elevenlabs: 'te' },
    cues: ['unda', 'kavali', 'emiti', 'cheppu', 'unna', 'ela'],
  },
  {
    codes: { sarvam: 'kn-IN', elevenlabs: 'kn' },
    cues: ['idya', 'beku', 'helu', 'yenadu', 'ide'],
  },
  {
    codes: MARATHI,
    cues: ['ahe', 'kahi', 'kitila', 'pahije', 'mala'],
  },
  {
    codes: ASSAMESE,
    cues: ['asen', 'kiyo', 'bhal', 'kio'],
  },
]

export function detectIndicLanguage(
  text: string | null | undefined,
): IndicLanguageCodes | null {
  const raw = text ?? ''
  if (!raw.trim()) return null

  let best: { count: number; codes: IndicLanguageCodes } | null = null
  for (const { re, codes } of SCRIPT_RANGES) {
    const count = raw.match(re)?.length ?? 0
    if (count > 0 && (!best || count > best.count)) {
      best = { count, codes }
    }
  }
  return best?.codes ?? null
}

export function detectRomanizedIndic(
  text: string | null | undefined,
): IndicLanguageCodes | null {
  const raw = (text ?? '').toLowerCase()
  if (!raw.trim()) return null

  let best: { score: number; codes: IndicLanguageCodes } | null = null
  for (const { codes, cues } of ROMANIZED) {
    let score = 0
    for (const cue of cues) {
      const re = new RegExp(`\\b${cue}\\b`, 'i')
      if (re.test(raw)) score += 1
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { score, codes }
    }
  }
  if (!best || best.score < 2) return null
  return best.codes
}

/**
 * Language for the spoken rewrite: native script first, else romanized
 * cues (Manglish / Hinglish / Tanglish / …). Latin-only English → null.
 */
export function detectSpokenIndicTarget(
  text: string | null | undefined,
): IndicLanguageCodes | null {
  const script = detectIndicLanguage(text)
  if (script) {
    const romanized = detectRomanizedIndic(text)
    if (script.elevenlabs === 'hi' && romanized?.elevenlabs === 'mr') {
      return MARATHI
    }
    if (script.elevenlabs === 'bn' && romanized?.elevenlabs === 'as') {
      return ASSAMESE
    }
    return script
  }
  return detectRomanizedIndic(text)
}

export function detectSarvamLanguage(
  text: string | null | undefined,
): string | null {
  const code = detectSpokenIndicTarget(text)?.sarvam
  return code || null
}

export function detectElevenLabsLanguage(
  text: string | null | undefined,
): string | null {
  return detectSpokenIndicTarget(text)?.elevenlabs ?? null
}

export function isIndicScript(text: string | null | undefined): boolean {
  return detectIndicLanguage(text) !== null
}

export function currencyWordForLanguage(
  codes: IndicLanguageCodes | null,
): string | null {
  if (!codes) return null
  return INDIC_CURRENCY_WORDS[codes.elevenlabs] ?? null
}
