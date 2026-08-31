import { engineSendText } from '@/lib/flows/meta-send'
import { detectIndicLanguage } from './indic-language'

/**
 * Immediate customer-facing line while vision + catalog match run.
 * Kept short and spoken — not "Please wait / Processing".
 */
export const PHOTO_WAIT_ACK = {
  ml: 'ഫോട്ടോ നോക്കട്ടെ, ഒന്ന് നിൽക്കൂ…',
  hi: 'फोटो देख रही हूँ, एक पल…',
  en: 'Let me check that photo — one moment.',
} as const

const ACK_SET = new Set<string>(Object.values(PHOTO_WAIT_ACK))

export function photoWaitAckText(hint?: string | null): string {
  const lang = detectIndicLanguage(hint)?.elevenlabs
  if (lang === 'ml') return PHOTO_WAIT_ACK.ml
  if (lang === 'hi') return PHOTO_WAIT_ACK.hi
  return PHOTO_WAIT_ACK.en
}

export function isPhotoWaitAck(text: string | null | undefined): boolean {
  return ACK_SET.has((text ?? '').trim())
}

export async function sendPhotoWaitAck(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  languageHint?: string | null
}): Promise<void> {
  await engineSendText({
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    text: photoWaitAckText(args.languageHint),
    aiGenerated: true,
  })
}
