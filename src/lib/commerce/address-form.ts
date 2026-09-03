import {
  ADDRESS_MESSAGE_FIELDS,
  type AddressMessageValues,
} from '@/lib/whatsapp/meta-api'
import { isCompleteBeneficiary, sanitizeBeneficiary } from './order-details'
import { sanitizeWebhookText } from './sanitize'
import type { CommerceBeneficiary } from './types'

/**
 * Body text on the native address form. Kept here (not in beneficiary.ts)
 * so the form copy sits next to the parser that reads its answer.
 */
export const ADDRESS_FORM_BODY =
  'Where should we deliver your order? Tap below to share your address.'

export interface AddressFormSubmission {
  /**
   * The customer's answer, normalized. Echoed straight back as `values`
   * when we have to re-ask, so a fix-one-field retry doesn't make them
   * retype the whole form.
   */
  values: AddressMessageValues
  /** Complete shipping address, or null when a required field is missing. */
  beneficiary: CommerceBeneficiary | null
  /** Inline errors keyed by form field, for the re-ask. */
  validationErrors: AddressMessageValues
}

/**
 * Parse an `nfm_reply.response_json` payload from Meta's India address
 * form into a `order_details` beneficiary.
 *
 * Meta splits the street across up to five fields (flat, floor, tower,
 * building, street) while `order_details` takes two address lines, so the
 * street parts collapse into `address_line1` and the landmark becomes
 * `address_line2`.
 */
export function parseAddressMessageReply(
  responseJson: unknown,
): AddressFormSubmission | null {
  const raw = asRecord(responseJson)
  if (!raw) return null

  const values: AddressMessageValues = {}
  for (const field of ADDRESS_MESSAGE_FIELDS) {
    const value = sanitizeWebhookText(raw[field], 120)
    if (value) values[field] = value
  }

  const postal = (values.in_pin_code ?? '').replace(/\D/g, '').slice(0, 6)
  const street = [
    values.house_number,
    values.floor_number,
    values.tower_number,
    values.building_name,
    values.address,
  ]
    .filter(Boolean)
    .join(', ')

  const validationErrors: AddressMessageValues = {}
  if (!values.name) validationErrors.name = 'Enter the name for delivery.'
  if (!street) validationErrors.address = 'Enter your street address.'
  if (!values.city) validationErrors.city = 'Enter your city.'
  if (!values.state) validationErrors.state = 'Enter your state.'
  if (postal.length !== 6) {
    validationErrors.in_pin_code = 'Enter a valid 6-digit PIN code.'
  }

  if (Object.keys(validationErrors).length > 0) {
    return { values, beneficiary: null, validationErrors }
  }

  const candidate: CommerceBeneficiary = {
    name: values.name!,
    address_line1: street,
    address_line2: values.landmark_area,
    city: values.city!,
    state: values.state!,
    country: 'India',
    postal_code: postal,
  }
  if (!isCompleteBeneficiary(candidate)) {
    return {
      values,
      beneficiary: null,
      validationErrors: { address: 'Enter your full delivery address.' },
    }
  }
  return {
    values,
    beneficiary: sanitizeBeneficiary(candidate),
    validationErrors: {},
  }
}

/**
 * Prefill for the form when we already have a probable address (Shopify
 * customer default, or the merchant's fallback ship-to). The street lands
 * in `address` as one line — Meta lets the customer split it themselves.
 */
export function addressFormValuesFromBeneficiary(
  beneficiary: CommerceBeneficiary | null,
  phone?: string | null,
): AddressMessageValues {
  const values: AddressMessageValues = {}
  if (phone?.trim()) values.phone_number = phone.trim()
  if (!beneficiary) return values
  values.name = beneficiary.name
  values.address = beneficiary.address_line1
  if (beneficiary.address_line2) values.landmark_area = beneficiary.address_line2
  values.city = beneficiary.city
  values.state = beneficiary.state
  values.in_pin_code = beneficiary.postal_code
  return values
}

/** One-line summary of a submitted address, for the inbox bubble. */
export function addressFormPreviewText(
  submission: AddressFormSubmission,
): string {
  const parts = [
    submission.values.name,
    submission.values.address ?? submission.values.building_name,
    submission.values.city,
    submission.values.in_pin_code,
  ].filter(Boolean)
  return parts.length > 0
    ? `Address: ${parts.join(', ')}`.slice(0, 1024)
    : '[Address form submitted]'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value) as unknown)
    } catch {
      return null
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
