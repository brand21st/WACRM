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
  const name = labeled('name') || fallbackName?.trim() || ''
  const address_line1 =
    labeled('address(?:\\s*1)?|line\\s*1') || firstUnlabeledLine(raw)
  const address_line2 = labeled('address\\s*2|line\\s*2') || undefined
  const city = labeled('city')
  const state = labeled('state|province')
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

function firstUnlabeledLine(text: string): string {
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/^(name|address|city|state|pin|postal)\b/i.test(t)) continue
    if (PIN_RE.test(t) && t.replace(/\D/g, '').length === 6) continue
    return t.slice(0, 100)
  }
  return ''
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
