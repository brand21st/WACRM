/**
 * Per-contact chat language lock.
 *
 * First confident customer turn wins. Stay there until they clearly ask
 * to change. Product names, SKUs, and a few English words are not a switch.
 */

import {
  detectSpokenIndicTarget,
  INDIC_LANGUAGE_NAMES,
  isIndicScript,
  type IndicLanguageCodes,
} from './indic-language'

export type ChatLanguageCode =
  | 'en'
  | 'ml'
  | 'hi'
  | 'ta'
  | 'te'
  | 'kn'
  | 'bn'
  | 'mr'
  | 'gu'
  | 'pa'
  | 'or'
  | 'as'
  | 'ur'

export type ChatLanguageScript = 'native' | 'romanized' | 'latin'

export type ChatLanguageLock = {
  code: ChatLanguageCode
  name: string
  script: ChatLanguageScript
  locked: boolean
}

export type StoredLanguageFacts = {
  language?: string | null
  language_code?: string | null
  language_script?: string | null
  language_locked?: boolean | null
}

export const CHAT_LANGUAGE_NAMES: Record<ChatLanguageCode, string> = {
  en: 'English',
  hi: INDIC_LANGUAGE_NAMES.hi,
  mr: INDIC_LANGUAGE_NAMES.mr,
  bn: INDIC_LANGUAGE_NAMES.bn,
  gu: INDIC_LANGUAGE_NAMES.gu,
  kn: INDIC_LANGUAGE_NAMES.kn,
  ml: INDIC_LANGUAGE_NAMES.ml,
  or: INDIC_LANGUAGE_NAMES.or,
  pa: INDIC_LANGUAGE_NAMES.pa,
  ta: INDIC_LANGUAGE_NAMES.ta,
  te: INDIC_LANGUAGE_NAMES.te,
  as: INDIC_LANGUAGE_NAMES.as,
  ur: INDIC_LANGUAGE_NAMES.ur,
}

const INDIC_ISO_CODES: Record<Exclude<ChatLanguageCode, 'en'>, IndicLanguageCodes> = {
  ml: { sarvam: 'ml-IN', elevenlabs: 'ml' },
  hi: { sarvam: 'hi-IN', elevenlabs: 'hi' },
  ta: { sarvam: 'ta-IN', elevenlabs: 'ta' },
  te: { sarvam: 'te-IN', elevenlabs: 'te' },
  kn: { sarvam: 'kn-IN', elevenlabs: 'kn' },
  bn: { sarvam: 'bn-IN', elevenlabs: 'bn' },
  mr: { sarvam: 'mr-IN', elevenlabs: 'mr' },
  gu: { sarvam: 'gu-IN', elevenlabs: 'gu' },
  pa: { sarvam: 'pa-IN', elevenlabs: 'pa' },
  or: { sarvam: 'od-IN', elevenlabs: 'or' },
  as: { sarvam: '', elevenlabs: 'as' },
  ur: { sarvam: '', elevenlabs: 'ur' },
}

const ACK_WORDS = new Set([
  'ok',
  'okay',
  'k',
  'kk',
  'hi',
  'hello',
  'hey',
  'yes',
  'no',
  'yeah',
  'yep',
  'nope',
  'thanks',
  'thank',
  'hmm',
  'hm',
  'hmmm',
  'lol',
])

const SIZE_WORDS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', 'xxxl', '2xl', '3xl', '4xl'])

const NAME_TO_CODE: Record<string, ChatLanguageCode> = {
  english: 'en',
  eng: 'en',
  en: 'en',
  malayalam: 'ml',
  manglish: 'ml',
  ml: 'ml',
  hindi: 'hi',
  hinglish: 'hi',
  hi: 'hi',
  tamil: 'ta',
  tanglish: 'ta',
  ta: 'ta',
  telugu: 'te',
  te: 'te',
  kannada: 'kn',
  kn: 'kn',
  bengali: 'bn',
  bangla: 'bn',
  bn: 'bn',
  marathi: 'mr',
  mr: 'mr',
  gujarati: 'gu',
  gu: 'gu',
  punjabi: 'pa',
  pa: 'pa',
  odia: 'or',
  oriya: 'or',
  or: 'or',
  assamese: 'as',
  as: 'as',
  urdu: 'ur',
  ur: 'ur',
}

type Alias = { code: ChatLanguageCode; script?: ChatLanguageScript; re: RegExp }

const LANGUAGE_ALIASES: Alias[] = [
  { code: 'en', re: /\b(?:english|eng)\b|ഇംഗ്ലീഷ്|अंग्रेजी|ஆங்கிலம்/i },
  { code: 'ml', script: 'romanized', re: /\bmanglish\b/i },
  { code: 'ml', re: /\bmalayalam\b|മലയാളം|मलयालम/i },
  { code: 'hi', script: 'romanized', re: /\bhinglish\b/i },
  { code: 'hi', re: /\bhindi\b|हिन्दी|हिंदी/i },
  { code: 'ta', script: 'romanized', re: /\btanglish\b/i },
  { code: 'ta', re: /\btamil\b|தமிழ்/i },
  { code: 'te', re: /\btelugu\b|తెలుగు/i },
  { code: 'kn', re: /\bkannada\b|ಕನ್ನಡ/i },
  { code: 'bn', re: /\b(?:bengali|bangla)\b|বাংলা/i },
  { code: 'mr', re: /\bmarathi\b|मराठी/i },
  { code: 'gu', re: /\bgujarati\b|ગુજરાતી/i },
  { code: 'pa', re: /\bpunjabi\b|ਪੰਜਾਬੀ/i },
  { code: 'or', re: /\b(?:odia|oriya)\b|ଓଡ଼ିଆ/i },
  { code: 'as', re: /\bassamese\b|অসমীয়া/i },
  { code: 'ur', re: /\burdu\b|اردو/i },
]

function lockOf(
  code: ChatLanguageCode,
  script?: ChatLanguageScript,
  locked = true,
): ChatLanguageLock {
  return {
    code,
    name: CHAT_LANGUAGE_NAMES[code] ?? code,
    script: script ?? defaultScript(code),
    locked,
  }
}

export function defaultScript(code: ChatLanguageCode): ChatLanguageScript {
  if (code === 'en') return 'latin'
  return 'native'
}

export function normalizeLanguageCode(
  raw: string | null | undefined,
): ChatLanguageCode | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (key in NAME_TO_CODE) return NAME_TO_CODE[key]
  const fromName = NAME_TO_CODE[key.replace(/[^a-z]/g, '')]
  return fromName ?? null
}

export function languageCodeFromName(
  raw: string | null | undefined,
): ChatLanguageCode | null {
  if (!raw) return null
  return normalizeLanguageCode(raw) ?? NAME_TO_CODE[raw.trim().toLowerCase()] ?? null
}

function isSkuToken(token: string): boolean {
  return /^(?:[A-Z]{2,}\d[\w-]*|\d+[A-Z][\w-]*)$/i.test(token) && /\d/.test(token)
}

function latinWords(text: string): string[] {
  return text.match(/[A-Za-z][A-Za-z'-]*/g) ?? []
}

function isConfidentEnglish(text: string): boolean {
  if (detectSpokenIndicTarget(text)) return false
  if (isIndicScript(text)) return false
  const words = latinWords(text)
  const meaningful = words.filter((word) => {
    const lower = word.toLowerCase()
    return !ACK_WORDS.has(lower) && !SIZE_WORDS.has(lower) && !isSkuToken(word)
  })
  if (meaningful.length < 3) return false
  const trimmed = text.trim()
  const question =
    /\?/.test(trimmed) ||
    /^(?:how|what|where|when|which|who|why|do|does|did|is|are|can|could|please|i|we|need|want|looking)\b/i.test(
      trimmed,
    )
  return meaningful.length >= 4 || (meaningful.length >= 3 && question)
}

function scriptForIndic(text: string): ChatLanguageScript {
  return isIndicScript(text) ? 'native' : 'romanized'
}

/** Confident language of this turn, or null (ok / hi / SKU / photo-only). */
export function detectChatLanguage(
  text: string | null | undefined,
): ChatLanguageLock | null {
  const raw = text?.trim() ?? ''
  if (!raw) return null
  const indic = detectSpokenIndicTarget(raw)
  if (indic) {
    return lockOf(indic.elevenlabs as ChatLanguageCode, scriptForIndic(raw))
  }
  if (isConfidentEnglish(raw)) return lockOf('en', 'latin')
  return null
}

function aliasIn(text: string): { code: ChatLanguageCode; script?: ChatLanguageScript } | null {
  for (const alias of LANGUAGE_ALIASES) {
    if (alias.re.test(text)) return { code: alias.code, script: alias.script }
  }
  return null
}

const SWITCH_TO_LANG =
  /\b(?:speak|talk|reply|chat|respond|answer|write)(?:\s+\w+){0,4}\s+(?:in|using)\s+/i
const SWITCH_SWITCH_TO = /\b(?:switch|change)(?:\s+\w+){0,3}\s+to\s+/i
const SWITCH_CHANGE_LANGUAGE = /\bchange(?:\s+the)?\s+(?:language|lang)(?:\s+to)?\s+/i
const SWITCH_FROM_NOW = /\bfrom now(?:\s+on)?(?:\s+in)?\s+/i
const ROMANIZED_LOCATIVE =
  /\b(english|hindi|malayalam|tamil|telugu|kannada|bengali|bangla|marathi|gujarati|punjabi|odia|oriya|assamese|urdu|manglish|hinglish|tanglish)\s+il\b/i
const ROMANIZED_ATHIL =
  /\b(malayalathil|hindiyil|tamilyil|telugulo|kannadadalli)\b/i
const NATIVE_SWITCHES: { re: RegExp; code: ChatLanguageCode }[] = [
  { re: /ഇംഗ്ലീഷിൽ|अंग्रेजी में|ஆங்கிலத்தில்/i, code: 'en' },
  { re: /മലയാളത്തിൽ|मलयालम में/i, code: 'ml' },
  { re: /ഹിന്ദിയിൽ|हिंदी में|हिन्दी में/i, code: 'hi' },
  { re: /தமிழில்/i, code: 'ta' },
]
const SHORT_STANDALONE =
  /^(?:please\s+)?(?:speak|talk|reply|chat)?(?:\s+in)?\s*(english|hindi|malayalam|tamil|telugu|kannada|bengali|bangla|marathi|gujarati|punjabi|odia|urdu|manglish|hinglish)\s*(?:please)?[.!?]?$/i

function locativeCode(match: string): ChatLanguageCode | null {
  if (/ഇംഗ്ലീഷ്|english|अंग्रेजी|ஆங்கிலம்/i.test(match)) return 'en'
  if (/മലയാള|malayalam|मलयालम|malayalathil/i.test(match)) return 'ml'
  if (/हिंद|hindi|hindiyil/i.test(match)) return 'hi'
  if (/தமிழ்|tamil|tamilyil/i.test(match)) return 'ta'
  if (/telugu|telugulo/i.test(match)) return 'te'
  if (/kannada|kannadadalli/i.test(match)) return 'kn'
  return aliasIn(match)?.code ?? null
}

/** Explicit “talk in Hindi / english il / മലയാളത്തിൽ” — not a product question. */
export function detectLanguageSwitch(
  text: string | null | undefined,
): ChatLanguageLock | null {
  const raw = text?.trim() ?? ''
  if (!raw) return null

  if (SWITCH_TO_LANG.test(raw) || SWITCH_SWITCH_TO.test(raw) || SWITCH_CHANGE_LANGUAGE.test(raw) || SWITCH_FROM_NOW.test(raw)) {
    const found = aliasIn(raw)
    if (found) return lockOf(found.code, found.script)
  }

  const il = raw.match(ROMANIZED_LOCATIVE)
  if (il?.[1]) {
    const code = normalizeLanguageCode(il[1])
    if (code) {
      const script = code === 'ml' && /manglish/i.test(il[1]) ? 'romanized' : defaultScript(code)
      return lockOf(code, /manglish|hinglish|tanglish/i.test(il[1]) ? 'romanized' : script)
    }
  }

  const athil = raw.match(ROMANIZED_ATHIL)
  if (athil?.[1]) {
    const code = locativeCode(athil[1])
    if (code) return lockOf(code)
  }

  for (const native of NATIVE_SWITCHES) {
    if (native.re.test(raw)) {
      return lockOf(native.code, native.code === 'en' ? 'latin' : 'native')
    }
  }

  if (raw.length <= 48) {
    const standalone = raw.match(SHORT_STANDALONE)
    if (standalone?.[1]) {
      const code = normalizeLanguageCode(standalone[1])
      if (code) {
        const script = /manglish|hinglish|tanglish/i.test(standalone[1])
          ? 'romanized'
          : defaultScript(code)
        return lockOf(code, script)
      }
    }
  }

  return null
}

export function storedLanguageLock(
  stored: StoredLanguageFacts | null | undefined,
): ChatLanguageLock | null {
  if (!stored) return null
  const code =
    normalizeLanguageCode(stored.language_code) ?? languageCodeFromName(stored.language)
  if (!code) return null
  const script =
    stored.language_script === 'native' ||
    stored.language_script === 'romanized' ||
    stored.language_script === 'latin'
      ? stored.language_script
      : defaultScript(code)
  return {
    code,
    name: stored.language?.trim() || CHAT_LANGUAGE_NAMES[code],
    script,
    locked: stored.language_locked === true,
  }
}

export function locksEqual(a: ChatLanguageLock | null, b: ChatLanguageLock | null): boolean {
  if (!a || !b) return false
  return a.code === b.code && a.script === b.script && a.locked === b.locked
}

/**
 * Decide the lock for this inbound turn.
 * `changed` means persist immediately.
 */
export function resolveLanguageLock(args: {
  customerText?: string | null
  stored?: StoredLanguageFacts | null
}): { lock: ChatLanguageLock | null; changed: boolean } {
  const switched = detectLanguageSwitch(args.customerText)
  const detected = detectChatLanguage(args.customerText)
  const prev = storedLanguageLock(args.stored)
  const prevHard = Boolean(prev?.locked)

  if (switched) {
    const next = { ...switched, locked: true }
    const same = prevHard && prev && prev.code === next.code && prev.script === next.script
    return { lock: next, changed: !same }
  }

  if (prevHard && prev) {
    return { lock: { ...prev, locked: true }, changed: false }
  }

  // Unlocked / missing: next confident inbound wins (heals a stale cron guess).
  if (detected) {
    const next = { ...detected, locked: true }
    return { lock: next, changed: true }
  }

  if (prev) return { lock: prev, changed: false }
  return { lock: null, changed: false }
}

export function indicCodesForLock(
  lock: ChatLanguageLock | null | undefined,
): IndicLanguageCodes | null {
  if (!lock || lock.code === 'en') return null
  return INDIC_ISO_CODES[lock.code] ?? null
}

/**
 * STT hint only after a hard lock. Soft cron guesses must not pin
 * Sarvam / Scribe / OpenAI to the wrong language on the first turn.
 */
export function sttHintFromHardLock(
  lock: ChatLanguageLock | null | undefined,
): { iso: string; sarvam: string } | null {
  if (!lock?.locked) return null
  if (lock.code === 'en') return { iso: 'en', sarvam: 'en-IN' }
  const codes = indicCodesForLock(lock)
  if (!codes) return { iso: lock.code, sarvam: 'unknown' }
  return {
    iso: codes.elevenlabs,
    sarvam: codes.sarvam || 'unknown',
  }
}

export function sarvamCodeFromIso(iso: string | null | undefined): string {
  const code = iso?.trim().toLowerCase() || ''
  if (!code) return 'unknown'
  if (code === 'en') return 'en-IN'
  const lock = {
    code: code as ChatLanguageCode,
    name: code,
    script: 'native' as const,
    locked: true,
  }
  return indicCodesForLock(lock)?.sarvam || 'unknown'
}

export const DETECT_FIRST_SPOKEN_LANGUAGE =
  'Detect the customer’s language from their first spoken words and stay there unless they ask to change. Product names are not a language change.'

export function formatReplyLanguageInstruction(
  lock: ChatLanguageLock | null | undefined,
): string {
  if (!lock) return ''
  const style =
    lock.script === 'native'
      ? 'native script'
      : lock.script === 'romanized'
        ? 'romanized mixed speech'
        : 'English'
  return (
    `Locked reply language: ${lock.name} (${style}). Always reply in this language and script. ` +
    `Product names, SKUs, and a few English words are not a language change. ` +
    `Only switch if they clearly ask to change language.`
  )
}

export function applyLanguageLockToFacts<T extends StoredLanguageFacts>(
  facts: T,
  lock: ChatLanguageLock,
): T {
  return {
    ...facts,
    language: lock.name,
    language_code: lock.code,
    language_script: lock.script,
    language_locked: true,
  }
}
