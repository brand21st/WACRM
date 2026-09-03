import { INDIC_LANGUAGE_NAMES } from '@/lib/ai/indic-language'
import {
  DETECT_FIRST_SPOKEN_LANGUAGE,
  formatReplyLanguageInstruction,
  sttHintFromHardLock,
  type ChatLanguageLock,
} from '@/lib/ai/language-lock'
import {
  LIVE_AI_HANDOFF_SPOKEN,
  LIVE_AI_HANDOFF_SPOKEN_ML,
} from '@/lib/calling/live-ai-constants'

export { LIVE_AI_HANDOFF_SPOKEN, LIVE_AI_HANDOFF_SPOKEN_ML }

export function liveAiHandoffSpoken(lock?: ChatLanguageLock | null): string {
  return lock?.locked && lock.code === 'ml' ? LIVE_AI_HANDOFF_SPOKEN_ML : LIVE_AI_HANDOFF_SPOKEN
}

export function isMalayalamLanguageHint(hint?: string | null): boolean {
  const value = hint?.trim()
  if (!value) return false
  return value === INDIC_LANGUAGE_NAMES.ml || /^malayalam$/i.test(value)
}

/**
 * Pin Realtime STT to Malayalam when the contact is locked or prior
 * WhatsApp already showed Malayalam — so GPT hears the first words correctly.
 */
export function liveAiTranscriptionLanguage(
  lock?: ChatLanguageLock | null,
  languageHint?: string | null,
): string | null {
  const hard = sttHintFromHardLock(lock)?.iso
  if (hard) return hard
  if (isMalayalamLanguageHint(languageHint)) return 'ml'
  return null
}

function malayalamNativeVoiceBlock(handoff: string): string {
  return (
    `## Language\n` +
    `This WhatsApp voice call is in Malayalam.\n` +
    `- Speak only Malayalam from the first word. Greet: «ഹലോ, എന്താ സഹായിക്കട്ടെ?»\n` +
    `- Do not reply in English unless they clearly ask to switch to English.\n` +
    `- Product names, SKUs, and a few English shop words are not a language change.\n` +
    `- Keep greetings, preambles, tool bridges, and the handoff in Malayalam.\n` +
    `- If they ask for a human, speak exactly: "${handoff}"\n` +
    `## Accent\n` +
    `Speak conversational Kerala Malayalam (shop-counter), not textbook or news-reader Malayalam.\n` +
    `- Keep the accent stable from the first word. Do not exaggerate.\n` +
    `- Think in Malayalam. Do not draft English and translate.\n` +
    `- Not «ഇത് നിങ്ങൾക്ക് ലഭ്യമാണ്» — say «ഇതുണ്ട്, നോക്കിക്കോ» (formal: «ഇതുണ്ട്, നോക്കൂ»).\n` +
    `- Do not use textbook «താങ്കൾ» unless they are formal.\n` +
    `- Prices: amount + രൂപ. Never say rupees, ₹, Rs, or INR.\n` +
    `- Do not change language based on their English accent or English product names.`
  )
}

function malayalamManglishVoiceBlock(handoff: string): string {
  return (
    `## Language\n` +
    `This WhatsApp voice call is in Manglish (spoken Malayalam with English shop words).\n` +
    `- Greet in everyday Manglish, e.g. «Hello, entha help cheyyatte?»\n` +
    `- Stay in Manglish. Do not switch to English-only or stiff written Malayalam.\n` +
    `- Product names, SKUs, and a few English shop words are not a language change.\n` +
    `- Keep greetings, preambles, and the handoff in the same mixed speech.\n` +
    `- If they ask for a human, speak exactly: "${handoff}"\n` +
    `## Accent\n` +
    `Speak with a natural Kerala rhythm. Keep the accent stable. Do not exaggerate.\n` +
    `- Think in Malayalam. Do not draft English and translate.\n` +
    `- Prices: amount + rupee or രൂപ, never ₹, Rs, or INR.`
  )
}

function malayalamHintVoiceBlock(): string {
  return (
    `## Language\n` +
    `Prior WhatsApp with this customer was Malayalam. Greet in conversational Kerala Malayalam: «ഹലോ, എന്താ സഹായിക്കട്ടെ?»\n` +
    `- If their first substantive words are Malayalam, stay in Malayalam for the whole call.\n` +
    `- Switch to English only if they clearly speak a full English request or ask for English.\n` +
    `- Do not switch based on accent, filler, or English product names.\n` +
    `## Accent\n` +
    `When speaking Malayalam, use shop-counter Kerala Malayalam — «ഇതുണ്ട്, നോക്കിക്കോ», prices in രൂപ.`
  )
}

function multilingualVoiceBlock(handoff: string): string {
  return (
    `${DETECT_FIRST_SPOKEN_LANGUAGE} ` +
    `Do not infer language from accent, filler, or English product names. ` +
    `If the first substantive utterance is Malayalam, speak conversational Kerala Malayalam and stay there. ` +
    `If they ask for a human, speak exactly: "${handoff}"`
  )
}

/** Realtime-2 language + accent pin for inbound live calls. */
export function liveAiSpokenLanguageBlock(
  lock?: ChatLanguageLock | null,
  languageHint?: string | null,
): string {
  const handoff = liveAiHandoffSpoken(lock)
  if (lock?.locked && lock.code === 'ml') {
    return lock.script === 'romanized'
      ? malayalamManglishVoiceBlock(handoff)
      : malayalamNativeVoiceBlock(handoff)
  }
  if (isMalayalamLanguageHint(languageHint)) {
    return malayalamHintVoiceBlock()
  }
  const generic = formatReplyLanguageInstruction(lock)
  if (generic) {
    return `${generic} If they ask for a human, speak exactly: "${handoff}"`
  }
  return multilingualVoiceBlock(handoff)
}
