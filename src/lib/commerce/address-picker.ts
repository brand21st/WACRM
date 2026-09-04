import {
  INTERACTIVE_LIMITS,
  type InteractiveListRow,
} from '@/lib/whatsapp/meta-api'
import { isValidReferenceId } from './money'
import type { CommerceBeneficiary } from './types'

/**
 * WhatsApp iOS often never renders Meta's native `saved_addresses`
 * picker (Android does). A list message is the same on both, so saved
 * addresses are offered as list rows and "Add new" opens the native form.
 */
const USE_PREFIX = 'wac_addr_use'
const NEW_PREFIX = 'wac_addr_new'

export const ADDRESS_PICKER_BUTTON_LABEL = 'Choose address'
export const ADD_NEW_ADDRESS_TITLE = 'Add new address'

export function savedAddressUseReplyId(
  referenceId: string,
  savedAddressId: string,
): string {
  return `${USE_PREFIX}:${referenceId}:${savedAddressId}`
}

export function addNewAddressReplyId(referenceId: string): string {
  return `${NEW_PREFIX}:${referenceId}`
}

export type SavedAddressPickerReply =
  | { action: 'use'; referenceId: string; savedAddressId: string }
  | { action: 'new'; referenceId: string }

export function parseSavedAddressPickerReply(
  replyId: string | null | undefined,
): SavedAddressPickerReply | null {
  const raw = (replyId ?? '').trim()
  const parts = raw.split(':')
  if (parts.length === 2 && parts[0] === NEW_PREFIX) {
    const referenceId = parts[1].trim()
    if (!isValidReferenceId(referenceId)) return null
    return { action: 'new', referenceId }
  }
  if (parts.length === 3 && parts[0] === USE_PREFIX) {
    const referenceId = parts[1].trim()
    const savedAddressId = parts[2].trim()
    if (!isValidReferenceId(referenceId) || !isSavedAddressRowId(savedAddressId)) {
      return null
    }
    return { action: 'use', referenceId, savedAddressId }
  }
  return null
}

export function isSavedAddressRowId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  )
}

export function savedAddressPickerRows(args: {
  referenceId: string
  addresses: Array<{ id: string; beneficiary: CommerceBeneficiary }>
}): InteractiveListRow[] {
  const usedTitles = new Set<string>()
  const rows: InteractiveListRow[] = args.addresses.map((entry) => {
    const title = uniqueTitle(pickerTitle(entry.beneficiary.name), usedTitles)
    usedTitles.add(title)
    return {
      id: savedAddressUseReplyId(args.referenceId, entry.id),
      title,
      description: pickerDescription(entry.beneficiary),
    }
  })
  rows.push({
    id: addNewAddressReplyId(args.referenceId),
    title: ADD_NEW_ADDRESS_TITLE,
  })
  return rows.slice(0, INTERACTIVE_LIMITS.maxListRowsTotal)
}

function pickerTitle(name: string): string {
  return clip(name.trim() || 'Saved address', INTERACTIVE_LIMITS.listRowTitleMaxLength)
}

function pickerDescription(beneficiary: CommerceBeneficiary): string {
  const text = [beneficiary.address_line1, beneficiary.city, beneficiary.postal_code]
    .filter(Boolean)
    .join(', ')
  return clip(text, INTERACTIVE_LIMITS.listRowDescriptionMaxLength)
}

function uniqueTitle(base: string, used: Set<string>): string {
  if (!used.has(base)) return base
  for (let n = 2; n < 10; n += 1) {
    const suffix = ` ${n}`
    const next = clip(base, INTERACTIVE_LIMITS.listRowTitleMaxLength - suffix.length) + suffix
    if (!used.has(next)) return next
  }
  return clip(`${base}*`, INTERACTIVE_LIMITS.listRowTitleMaxLength)
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}
