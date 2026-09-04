import { isValidReferenceId } from './money'

const SKIP_PREFIX = 'wac_email_skip'

export const SKIP_EMAIL_BUTTON_TITLE = 'Skip'

export const EMAIL_PROMPT =
  'Email for the Shopify order receipt? Send it now, or tap Skip.'

export const EMAIL_INVALID_PROMPT =
  'That does not look like an email. Send a valid address, or tap Skip.'

export function emailSkipReplyId(referenceId: string): string {
  return `${SKIP_PREFIX}:${referenceId}`
}

export function parseEmailSkipReply(
  replyId: string | null | undefined,
): { referenceId: string } | null {
  const raw = (replyId ?? '').trim()
  const separator = raw.indexOf(':')
  if (separator < 0) return null
  const prefix = raw.slice(0, separator)
  const referenceId = raw.slice(separator + 1).trim()
  if (prefix !== SKIP_PREFIX) return null
  if (!isValidReferenceId(referenceId)) return null
  return { referenceId }
}

const SKIP_TEXT = new Set(['skip', 'no', 'nope', 'none', 'n/a', 'na', 'without'])

export function isEmailSkipText(text: string): boolean {
  return SKIP_TEXT.has(text.trim().toLowerCase())
}

export function parseOptionalEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase()
  if (value.length > 120) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null
  return value
}
