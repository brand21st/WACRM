import { isValidReferenceId } from './money'

const SKIP_PREFIX = 'wac_disc_skip'

export const SKIP_DISCOUNT_BUTTON_TITLE = 'Skip'

export const DISCOUNT_PROMPT =
  'Have a discount code? Send it now, or tap Skip to pay the full amount.'

export const DISCOUNT_INVALID_PROMPT =
  'That code isn’t valid for this order. Send another, or tap Skip to pay the full amount.'

export function discountSkipReplyId(referenceId: string): string {
  return `${SKIP_PREFIX}:${referenceId}`
}

export function parseDiscountSkipReply(
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

/** Typed “no thanks” answers that should skip lookup. */
const SKIP_TEXT = new Set(['skip', 'no', 'nope', 'none', 'n/a', 'na', 'without'])

export function isDiscountSkipText(text: string): boolean {
  return SKIP_TEXT.has(text.trim().toLowerCase())
}

/**
 * Shopify codes are letters, digits, hyphen, underscore. Keep them
 * short so a paragraph of chat is not treated as a coupon.
 */
export function sanitizeDiscountCode(raw: string): string {
  return raw.trim().slice(0, 40)
}

export function isPlausibleDiscountCode(raw: string): boolean {
  const code = sanitizeDiscountCode(raw)
  return /^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(code)
}
