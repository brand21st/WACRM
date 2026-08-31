import { normalizePhone, phonesMatch } from '@/lib/whatsapp/phone-utils'

/** True when any Shopify-side phone matches the WhatsApp contact. */
export function shopifyPhoneMatchesContact(
  contactPhone: string,
  candidates: Array<string | null | undefined>,
): boolean {
  const contact = normalizePhone(contactPhone)
  if (!contact) return false
  for (const raw of candidates) {
    if (!raw) continue
    if (phonesMatch(contact, raw)) return true
  }
  return false
}

/** Shopify customer search query from a WhatsApp digits-only phone. */
export function customerSearchQueries(contactPhone: string): string[] {
  const digits = normalizePhone(contactPhone)
  if (!digits) return []
  const out = new Set<string>()
  out.add(`phone:${digits}`)
  out.add(`phone:+${digits}`)
  if (digits.length > 8) {
    out.add(`phone:${digits.slice(-10)}`)
  }
  return [...out]
}
