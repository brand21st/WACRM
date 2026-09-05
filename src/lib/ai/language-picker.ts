import type { InteractiveListSection } from '@/lib/whatsapp/interactive'
import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'
import type { ChatLanguageCode, ChatLanguageLock } from './language-lock'

/** Reply ids for the first-inbound WhatsApp language list. */
export const LANGUAGE_PICKER_PREFIX = 'wacrm:lang:'

export const LANGUAGE_PICKER_IDS = {
  en: `${LANGUAGE_PICKER_PREFIX}en`,
  hi: `${LANGUAGE_PICKER_PREFIX}hi`,
  ml: `${LANGUAGE_PICKER_PREFIX}ml`,
  ta: `${LANGUAGE_PICKER_PREFIX}ta`,
} as const

export type LanguagePickerCode = keyof typeof LANGUAGE_PICKER_IDS

const PICKER_ID_RE = /wacrm:lang:(en|hi|ml|ta)\b/

const GREETING_RE =
  /^(?:hi+|hello|hey+|hola|namaste|namaskar(?:am)?|vanakkam|ഹായ്|നമസ്കാരം|नमस्ते|नमस्कार|வணக்கம்)(?:[.!,\s]*)?$/iu

const CONFIRM: Partial<Record<ChatLanguageCode, string>> = {
  en: 'Got it — I’ll reply in English.',
  hi: 'ठीक है — अब मैं हिंदी में जवाब दूँगा।',
  ml: 'ശരി — ഇനി മലയാളത്തിൽ മറുപടി നൽകാം.',
  ta: 'சரி — இனி தமிழில் பதில் சொல்கிறேன்.',
}

const HELP_ASK: Partial<Record<ChatLanguageCode, string>> = {
  en: 'How can I help you?',
  hi: 'मैं आपकी कैसे मदद करूँ?',
  ml: 'എന്ത് സഹായം വേണം?',
  ta: 'எப்படி உதவட்டும்?',
}

/** Parse `wacrm:lang:en|hi|ml|ta` from a raw id or a formatted tap line. */
export function languagePickerCode(
  raw: string | null | undefined,
): LanguagePickerCode | null {
  if (!raw) return null
  const match = raw.trim().match(PICKER_ID_RE)
  return (match?.[1] as LanguagePickerCode | undefined) ?? null
}

export function isLanguagePickerReply(id: string | null | undefined): boolean {
  return languagePickerCode(id) !== null
}

export function languageWelcomeHi(firstName?: string | null): string {
  const name = firstName?.trim()
  return name ? `Hi, ${name}` : 'Hi'
}

export function buildLanguagePickerList(): {
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
} {
  const rows = [
    { id: LANGUAGE_PICKER_IDS.en, title: 'English', description: 'English' },
    { id: LANGUAGE_PICKER_IDS.hi, title: 'Hindi', description: 'हिंदी' },
    { id: LANGUAGE_PICKER_IDS.ml, title: 'Malayalam', description: 'മലയാളം' },
    { id: LANGUAGE_PICKER_IDS.ta, title: 'Tamil', description: 'தமிழ்' },
  ]
  for (const row of rows) {
    if (row.title.length > INTERACTIVE_LIMITS.listRowTitleMaxLength) {
      throw new Error(`Language picker title "${row.title}" exceeds Meta’s limit`)
    }
  }
  return {
    bodyText: 'What’s your language?',
    buttonLabel: 'Language',
    sections: [{ title: 'Languages', rows }],
  }
}

export function languageLockConfirmation(lock: ChatLanguageLock): string {
  return CONFIRM[lock.code] ?? `Got it — I’ll reply in ${lock.name}.`
}

export function languageHelpAsk(lock: ChatLanguageLock): string {
  return HELP_ASK[lock.code] ?? 'How can I help you?'
}

export function isCasualGreeting(text: string): boolean {
  const raw = text.trim()
  if (!raw) return true
  if (languagePickerCode(raw)) return true
  return GREETING_RE.test(raw)
}

/** Latest customer ask before the current language tap / name, if any. */
export function priorCustomerQuestion(
  messages: { role: string; content: string }[],
): string | null {
  const users = messages.filter((m) => m.role === 'user')
  for (let i = users.length - 2; i >= 0; i--) {
    const text = users[i]?.content?.trim() ?? ''
    if (text && !isCasualGreeting(text)) return text
  }
  return null
}
