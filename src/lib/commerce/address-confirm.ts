import type { CommerceBeneficiary } from './types'
import { isValidReferenceId } from './money'

/**
 * Reply-button ids for the address confirmation step. The order's
 * reference id travels inside the id, so a tap identifies its own order
 * without any per-conversation state to look up — and a stale button
 * from an older cart still resolves to the right bill.
 */
const CONFIRM_PREFIX = 'wac_addr_ok'
const EDIT_PREFIX = 'wac_addr_edit'

export const CONFIRM_BUTTON_TITLE = 'Confirm & pay'
export const EDIT_BUTTON_TITLE = 'Change address'

export function addressConfirmReplyId(referenceId: string): string {
  return `${CONFIRM_PREFIX}:${referenceId}`
}

export function addressEditReplyId(referenceId: string): string {
  return `${EDIT_PREFIX}:${referenceId}`
}

export interface AddressConfirmReply {
  action: 'confirm' | 'edit'
  referenceId: string
}

/**
 * Read a tapped button id. Returns null for every other interactive
 * reply so the caller can fall through to flows and automations.
 */
export function parseAddressConfirmReply(
  replyId: string | null | undefined,
): AddressConfirmReply | null {
  const raw = (replyId ?? '').trim()
  const separator = raw.indexOf(':')
  if (separator < 0) return null
  const prefix = raw.slice(0, separator)
  const referenceId = raw.slice(separator + 1).trim()
  if (!isValidReferenceId(referenceId)) return null
  if (prefix === CONFIRM_PREFIX) return { action: 'confirm', referenceId }
  if (prefix === EDIT_PREFIX) return { action: 'edit', referenceId }
  return null
}

/** Rupees from paise, for message copy (the bill itself uses inrAmount). */
export function formatInrFromPaise(paise: number): string {
  const value = Math.max(0, Math.round(paise)) / 100
  return `₹${value.toFixed(2)}`
}

/**
 * The address we're about to ship to, shown before asking for money so a
 * wrong address is caught while it's still free to fix.
 */
export function addressConfirmationBody(args: {
  beneficiary: CommerceBeneficiary
  totalPaise: number
  itemCount: number
}): string {
  const b = args.beneficiary
  const lines = [
    b.name,
    b.address_line1,
    b.address_line2,
    `${b.city}, ${b.state} ${b.postal_code}`,
    b.email,
  ].filter(Boolean)
  const items = args.itemCount === 1 ? '1 item' : `${args.itemCount} items`
  return [
    'Please confirm your delivery address:',
    '',
    ...lines,
    '',
    `${items} · ${formatInrFromPaise(args.totalPaise)}`,
  ].join('\n')
}
