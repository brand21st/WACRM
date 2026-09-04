import { shopifyGraphql } from '@/lib/shopify/client'
import { CUSTOMER_ADDRESS_BY_QUERY } from '@/lib/shopify/queries'
import { customerSearchQueries, shopifyPhoneMatchesContact, toShopifyPhone } from '@/lib/shopify/phone'
import type { ShopifyStoreConfig } from '@/lib/shopify/types'
import {
  VACHAT_ORDER_TAG,
  WHATSAPP_COMMERCE_DISPLAY_TAG,
} from './shopify-order'
import type { CommerceBeneficiary } from './types'

export const CUSTOMER_CREATE_MUTATION = `
mutation WhatsAppCommerceCustomerCreate($input: CustomerInput!) {
  customerCreate(input: $input) {
    userErrors { field message }
    customer { id }
  }
}
`

export const CUSTOMER_UPDATE_MUTATION = `
mutation WhatsAppCommerceCustomerUpdate($input: CustomerInput!) {
  customerUpdate(input: $input) {
    userErrors { field message }
    customer { id }
  }
}
`

export const CUSTOMER_ADDRESS_CREATE_MUTATION = `
mutation WhatsAppCommerceCustomerAddressCreate(
  $customerId: ID!
  $address: MailingAddressInput!
  $setAsDefault: Boolean
) {
  customerAddressCreate(
    customerId: $customerId
    address: $address
    setAsDefault: $setAsDefault
  ) {
    userErrors { field message }
    address { id }
  }
}
`

export const CUSTOMER_TAGS = [WHATSAPP_COMMERCE_DISPLAY_TAG, VACHAT_ORDER_TAG]

interface FoundCustomer {
  id: string
  email?: string | null
  tags?: string | null
  phone?: string | null
  defaultAddress?: { phone?: string | null } | null
}

export function mailingAddressFromBeneficiary(args: {
  beneficiary: CommerceBeneficiary
  phone?: string | null
}): Record<string, unknown> {
  const phone = toShopifyPhone(args.phone)
  return {
    firstName: firstName(args.beneficiary.name),
    lastName: lastName(args.beneficiary.name),
    address1: args.beneficiary.address_line1,
    address2: args.beneficiary.address_line2 || undefined,
    city: args.beneficiary.city,
    province: args.beneficiary.state,
    countryCode: 'IN',
    zip: args.beneficiary.postal_code,
    phone,
  }
}

/**
 * Find or create the Shopify customer for a paid WhatsApp order and
 * save the delivery address as the default. Failures return null so
 * orderCreate can still proceed.
 */
export async function upsertShopifyCustomerForPayment(args: {
  config: ShopifyStoreConfig
  phone: string | null
  email?: string | null
  beneficiary: CommerceBeneficiary | null
}): Promise<string | null> {
  const phone = toShopifyPhone(args.phone) ?? args.phone?.trim() ?? ''
  const email = args.email?.trim() || args.beneficiary?.email?.trim() || ''
  if (!phone && !email && !args.beneficiary) return null

  try {
    const existing = phone
      ? await findCustomerByPhone(args.config, phone)
      : null
    if (existing?.id) {
      await updateExistingCustomer(args.config, existing, {
        email,
        beneficiary: args.beneficiary,
        phone,
      })
      return existing.id
    }

    if (!args.beneficiary && !phone && !email) return null

    const data = await shopifyGraphql<{
      customerCreate?: {
        userErrors?: { message?: string }[]
        customer?: { id?: string } | null
      }
    }>({
      shopDomain: args.config.shopDomain,
      accessToken: args.config.accessToken,
      query: CUSTOMER_CREATE_MUTATION,
      variables: {
        input: {
          firstName: args.beneficiary ? firstName(args.beneficiary.name) : undefined,
          lastName: args.beneficiary ? lastName(args.beneficiary.name) : undefined,
          phone: toShopifyPhone(args.phone),
          ...(email ? { email } : {}),
          tags: CUSTOMER_TAGS,
          ...(args.beneficiary
            ? { addresses: [mailingAddressFromBeneficiary({ beneficiary: args.beneficiary, phone: args.phone })] }
            : {}),
        },
      },
    })
    const errors = data.customerCreate?.userErrors?.filter((e) => e.message) ?? []
    if (errors.length > 0) {
      console.error(
        '[commerce] Shopify customerCreate failed:',
        errors.map((e) => e.message).join('; '),
      )
      return null
    }
    return data.customerCreate?.customer?.id ?? null
  } catch (err) {
    console.error('[commerce] Shopify customer upsert failed:', err)
    return null
  }
}

export async function lookupShopifyCustomerEmail(args: {
  config: ShopifyStoreConfig
  phone: string | null
}): Promise<string | null> {
  const phone = toShopifyPhone(args.phone) ?? args.phone?.trim() ?? ''
  if (!phone) return null
  try {
    const found = await findCustomerByPhone(args.config, phone)
    const email = found?.email?.trim()
    return email || null
  } catch (err) {
    console.warn('[commerce] Shopify customer email lookup failed:', err)
    return null
  }
}

async function findCustomerByPhone(
  config: ShopifyStoreConfig,
  phone: string,
): Promise<FoundCustomer | null> {
  for (const query of customerSearchQueries(phone)) {
    const data = await shopifyGraphql<{
      customers?: { nodes?: FoundCustomer[] }
    }>({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: CUSTOMER_ADDRESS_BY_QUERY,
      variables: { query },
    })
    for (const customer of data.customers?.nodes ?? []) {
      if (!customer.id) continue
      if (
        !shopifyPhoneMatchesContact(phone, [
          customer.phone,
          customer.defaultAddress?.phone,
        ]) &&
        customer.phone
      ) {
        continue
      }
      return customer
    }
  }
  return null
}

async function updateExistingCustomer(
  config: ShopifyStoreConfig,
  existing: FoundCustomer,
  args: {
    email: string
    phone: string
    beneficiary: CommerceBeneficiary | null
  },
): Promise<void> {
  const tags = mergeCustomerTags(existing.tags)
  const email = args.email && args.email !== existing.email ? args.email : undefined
  if (email || tagsChanged(existing.tags, tags)) {
    try {
      await shopifyGraphql({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        query: CUSTOMER_UPDATE_MUTATION,
        variables: {
          input: {
            id: existing.id,
            ...(email ? { email } : {}),
            tags,
          },
        },
      })
    } catch (err) {
      console.warn('[commerce] Shopify customerUpdate failed:', err)
    }
  }

  if (!args.beneficiary) return
  try {
    await shopifyGraphql({
      shopDomain: config.shopDomain,
      accessToken: config.accessToken,
      query: CUSTOMER_ADDRESS_CREATE_MUTATION,
      variables: {
        customerId: existing.id,
        setAsDefault: true,
        address: mailingAddressFromBeneficiary({
          beneficiary: args.beneficiary,
          phone: args.phone,
        }),
      },
    })
  } catch (err) {
    console.warn('[commerce] Shopify customerAddressCreate failed:', err)
  }
}

function mergeCustomerTags(existing: string | null | undefined): string[] {
  const have = new Set(
    (existing ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
  for (const tag of CUSTOMER_TAGS) have.add(tag)
  return [...have]
}

function tagsChanged(existing: string | null | undefined, next: string[]): boolean {
  const have = new Set(
    (existing ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
  return next.some((tag) => !have.has(tag))
}

function firstName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[0] || name
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts.slice(1).join(' ') || parts[0] || name
}
