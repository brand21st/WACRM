import type { SupabaseClient } from '@supabase/supabase-js'
import { shopifyGraphql } from '@/lib/shopify/client'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { customerSearchQueries, shopifyPhoneMatchesContact } from '@/lib/shopify/phone'
import { CUSTOMER_ADDRESS_BY_QUERY } from '@/lib/shopify/queries'
import {
  isCompleteBeneficiary,
  sanitizeBeneficiary,
} from './order-details'
import type { CommerceBeneficiary } from './types'

const PIN_RE = /\b(\d{6})\b/
const LABEL_LINE_RE = /^\s*(?:name|address(?:\s*[12])?|line\s*[12]|city|state|province|pin(?:code)?|postal|zip)\s*[:\-]/i

/**
 * States and union territories, plus the spellings people actually type.
 * Used to locate the state line in an address that has no field labels —
 * customers overwhelmingly send one value per line rather than filling in
 * the `City:` / `State:` template, and anchoring on the state is what
 * makes the surrounding lines unambiguous.
 */
const STATE_ALIASES: Record<string, string> = {
  andamanandnicobarislands: 'Andaman and Nicobar Islands',
  andhrapradesh: 'Andhra Pradesh',
  arunachalpradesh: 'Arunachal Pradesh',
  assam: 'Assam',
  bihar: 'Bihar',
  chandigarh: 'Chandigarh',
  chhattisgarh: 'Chhattisgarh',
  delhi: 'Delhi',
  newdelhi: 'Delhi',
  nctofdelhi: 'Delhi',
  goa: 'Goa',
  gujarat: 'Gujarat',
  haryana: 'Haryana',
  himachalpradesh: 'Himachal Pradesh',
  jammuandkashmir: 'Jammu and Kashmir',
  jharkhand: 'Jharkhand',
  karnataka: 'Karnataka',
  kerala: 'Kerala',
  ladakh: 'Ladakh',
  lakshadweep: 'Lakshadweep',
  madhyapradesh: 'Madhya Pradesh',
  maharashtra: 'Maharashtra',
  manipur: 'Manipur',
  meghalaya: 'Meghalaya',
  mizoram: 'Mizoram',
  nagaland: 'Nagaland',
  odisha: 'Odisha',
  orissa: 'Odisha',
  puducherry: 'Puducherry',
  pondicherry: 'Puducherry',
  punjab: 'Punjab',
  rajasthan: 'Rajasthan',
  sikkim: 'Sikkim',
  tamilnadu: 'Tamil Nadu',
  telangana: 'Telangana',
  tripura: 'Tripura',
  uttarakhand: 'Uttarakhand',
  uttaranchal: 'Uttarakhand',
  uttarpradesh: 'Uttar Pradesh',
  westbengal: 'West Bengal',
}

/** Canonical state name for a typed line, or null when it isn't a state. */
export function canonicalIndianState(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z]/g, '')
  return key ? (STATE_ALIASES[key] ?? null) : null
}

export function parseBeneficiaryFromText(
  text: string,
  fallbackName?: string | null,
): CommerceBeneficiary | null {
  const raw = text.replace(/\r/g, '').trim()
  if (!raw) return null
  const labeled = (pattern: string) => {
    const match = new RegExp(
      `(?:^|\\n)\\s*(?:${pattern})\\s*[:\\-]\\s*(.+)`,
      'i',
    ).exec(raw)
    return match?.[1]?.trim() || ''
  }
  const pinMatch = PIN_RE.exec(raw)
  const postal =
    labeled('pin(?:code)?|postal|zip').replace(/\D/g, '').slice(0, 6) ||
    pinMatch?.[1] ||
    ''

  // Labels win when present; anything the customer left unlabeled is
  // recovered positionally below.
  const loose = parseUnlabeledAddress(raw)
  const name = labeled('name') || loose.name || fallbackName?.trim() || ''
  const address_line1 =
    labeled('address(?:\\s*1)?|line\\s*1') || loose.addressLine1
  const address_line2 =
    labeled('address\\s*2|line\\s*2') || loose.addressLine2 || undefined
  const city = labeled('city') || loose.city
  const state = labeled('state|province') || loose.state
  const candidate: CommerceBeneficiary = {
    name,
    address_line1,
    address_line2,
    city,
    state,
    country: 'India',
    postal_code: postal,
  }
  return isCompleteBeneficiary(candidate) ? sanitizeBeneficiary(candidate) : null
}

interface LooseAddress {
  name: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
}

/**
 * Read an address typed without field labels, e.g.
 *
 *   Goutham
 *   Wayanad house
 *   Sulthan Bathery
 *   Wayanad
 *   Kerala
 *   673592
 *
 * Works back from the end: the state anchors the parse, the line before it
 * is the city, a leading line is the recipient when enough lines remain,
 * and whatever sits between becomes the street. A single comma-separated
 * line is split and read the same way.
 */
function parseUnlabeledAddress(raw: string): LooseAddress {
  const empty: LooseAddress = {
    name: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
  }

  let parts = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !LABEL_LINE_RE.test(line))
  if (parts.length === 1) {
    parts = parts[0]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  // Drop the PIN — it's already read by its own regex.
  parts = parts.filter((part) => part.replace(/\D/g, '').length !== 6)
  if (parts.length === 0) return empty

  let state = ''
  let rest = parts
  for (let i = parts.length - 1; i >= 0; i--) {
    const canonical = canonicalIndianState(parts[i])
    if (canonical) {
      state = canonical
      rest = parts.slice(0, i)
      break
    }
  }
  if (!state && parts.length >= 3) {
    // No recognised state name — fall back to position so an unusual
    // spelling still resolves rather than looping the prompt forever.
    state = parts[parts.length - 1]
    rest = parts.slice(0, -1)
  }
  if (rest.length === 0) return { ...empty, state }

  const city = rest[rest.length - 1]
  rest = rest.slice(0, -1)

  let name = ''
  if (rest.length >= 2) {
    name = rest[0]
    rest = rest.slice(1)
  }

  return {
    name,
    addressLine1: rest.join(', '),
    addressLine2: '',
    city,
    state,
  }
}

export async function resolveBeneficiary(args: {
  db: SupabaseClient
  accountId: string
  contactPhone: string | null
  contactName: string | null
  settingsDefault: CommerceBeneficiary | null
}): Promise<CommerceBeneficiary | null> {
  if (args.contactPhone) {
    const fromShopify = await beneficiaryFromShopifyCustomer(
      args.db,
      args.accountId,
      args.contactPhone,
    )
    if (fromShopify) return fromShopify
  }
  if (args.settingsDefault && isCompleteBeneficiary(args.settingsDefault)) {
    return sanitizeBeneficiary(args.settingsDefault)
  }
  return null
}

async function beneficiaryFromShopifyCustomer(
  db: SupabaseClient,
  accountId: string,
  phone: string,
): Promise<CommerceBeneficiary | null> {
  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  if (!config) return null
  for (const query of customerSearchQueries(phone)) {
    try {
      const data = await shopifyGraphql<{
        customers?: {
          nodes?: Array<{
            displayName?: string | null
            phone?: string | null
            defaultAddress?: ShopifyAddress | null
          }>
        }
      }>({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        query: CUSTOMER_ADDRESS_BY_QUERY,
        variables: { query },
      })
      for (const customer of data.customers?.nodes ?? []) {
        if (
          !shopifyPhoneMatchesContact(phone, [
            customer.phone,
            customer.defaultAddress?.phone,
          ]) &&
          customer.phone
        ) {
          continue
        }
        const mapped = beneficiaryFromAddress(
          customer.defaultAddress,
          customer.displayName,
        )
        if (mapped) return mapped
      }
    } catch (err) {
      console.warn('[commerce] Shopify customer address lookup failed:', err)
    }
  }
  return null
}

interface ShopifyAddress {
  name?: string | null
  firstName?: string | null
  lastName?: string | null
  phone?: string | null
  address1?: string | null
  address2?: string | null
  city?: string | null
  province?: string | null
  zip?: string | null
  country?: string | null
}

function beneficiaryFromAddress(
  address: ShopifyAddress | null | undefined,
  displayName?: string | null,
): CommerceBeneficiary | null {
  if (!address) return null
  const name =
    address.name?.trim() ||
    [address.firstName, address.lastName].filter(Boolean).join(' ').trim() ||
    displayName?.trim() ||
    ''
  const candidate: CommerceBeneficiary = {
    name,
    address_line1: address.address1?.trim() || '',
    address_line2: address.address2?.trim() || undefined,
    city: address.city?.trim() || '',
    state: address.province?.trim() || '',
    country: 'India',
    postal_code: (address.zip ?? '').replace(/\D/g, '').slice(0, 6),
  }
  return isCompleteBeneficiary(candidate) ? sanitizeBeneficiary(candidate) : null
}

export const ADDRESS_PROMPT =
  'Please send your delivery address in India so I can send the bill:\nName:\nAddress:\nCity:\nState:\nPIN:'
