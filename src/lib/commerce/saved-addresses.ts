import type { SupabaseClient } from '@supabase/supabase-js'
import type { AddressMessageValues } from '@/lib/whatsapp/meta-api'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import { addressFormValuesFromBeneficiary } from './address-form'
import { isCompleteBeneficiary } from './order-details'
import type { CommerceBeneficiary } from './types'

/**
 * How many addresses the native form offers. WhatsApp renders them as a
 * picker, so the list is kept to the handful a customer actually reuses
 * (home, work, family) rather than every address they have ever typed.
 */
export const SAVED_ADDRESS_LIMIT = 5

export interface SavedAddressRow {
  id: string
  beneficiary: CommerceBeneficiary
  formValues: AddressMessageValues
}

/**
 * Stable identity for an address, so re-submitting one the customer
 * already has updates it instead of adding a duplicate to the picker.
 */
export function addressFingerprint(beneficiary: CommerceBeneficiary): string {
  return [
    beneficiary.name,
    beneficiary.address_line1,
    beneficiary.address_line2 ?? '',
    beneficiary.city,
    beneficiary.state,
    beneficiary.postal_code,
  ]
    .join('|')
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, '')
    .slice(0, 300)
}

/**
 * The customer's addresses, most recently used first. Returned in the
 * shape `sendAddressMessage` wants, with each row's own id so the
 * `saved_address_id` in the reply maps straight back to this table.
 */
export async function loadSavedAddresses(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<Array<{ id: string; value: AddressMessageValues }>> {
  const rows = await loadSavedAddressRows(db, accountId, contactId)
  return rows.map((row) => ({
    id: row.id,
    // Fall back to a reconstruction when a row predates form_values.
    value:
      Object.keys(row.formValues).length > 0
        ? row.formValues
        : addressFormValuesFromBeneficiary(row.beneficiary),
  }))
}

export async function loadSavedAddressRows(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<SavedAddressRow[]> {
  const { data, error } = await db
    .from('contact_saved_addresses')
    .select('id, beneficiary, form_values')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .order('last_used_at', { ascending: false })
    .limit(SAVED_ADDRESS_LIMIT)
  if (error) {
    // The picker is an enhancement; a missing table must not block
    // checkout on an account that hasn't run migration 066 yet.
    if (!isMissingDbRelation(error, 'contact_saved_addresses')) {
      console.warn('[commerce] load saved addresses failed:', error)
    }
    return []
  }
  return (data ?? [])
    .map((row) => ({
      id: String(row.id),
      beneficiary: row.beneficiary as CommerceBeneficiary,
      formValues: (row.form_values ?? {}) as AddressMessageValues,
    }))
    .filter((row) => isCompleteBeneficiary(row.beneficiary))
}

/**
 * Remember an address the customer just gave us. Best-effort: a failure
 * here costs the picker on a later order, never the current checkout.
 */
export async function rememberSavedAddress(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  beneficiary: CommerceBeneficiary
  formValues?: AddressMessageValues
}): Promise<void> {
  if (!isCompleteBeneficiary(args.beneficiary)) return
  const now = new Date().toISOString()
  const { error } = await args.db.from('contact_saved_addresses').upsert(
    {
      account_id: args.accountId,
      contact_id: args.contactId,
      beneficiary: args.beneficiary,
      form_values:
        args.formValues && Object.keys(args.formValues).length > 0
          ? args.formValues
          : addressFormValuesFromBeneficiary(args.beneficiary),
      fingerprint: addressFingerprint(args.beneficiary),
      last_used_at: now,
    },
    { onConflict: 'contact_id,fingerprint' },
  )
  if (error && !isMissingDbRelation(error, 'contact_saved_addresses')) {
    console.warn('[commerce] remember saved address failed:', error)
  }
}

/**
 * Move a reused address back to the top of the picker. Called when the
 * reply carries a `saved_address_id` we recognise.
 */
export async function touchSavedAddress(args: {
  db: SupabaseClient
  accountId: string
  savedAddressId: string
}): Promise<void> {
  const id = args.savedAddressId.trim()
  // The id round-trips through Meta, so treat anything that isn't one of
  // our own row ids as unknown rather than letting Postgres reject the
  // uuid cast.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return
  }
  const { error } = await args.db
    .from('contact_saved_addresses')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
    .eq('account_id', args.accountId)
  if (error && !isMissingDbRelation(error, 'contact_saved_addresses')) {
    console.warn('[commerce] touch saved address failed:', error)
  }
}
