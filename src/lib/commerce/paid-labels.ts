import type { SupabaseClient } from '@supabase/supabase-js'

import { findExistingContact } from '@/lib/contacts/dedupe'
import { isMissingDbColumn } from '@/lib/shopify/config-db'
import { firstValidShopifyPhone } from '@/lib/shopify/notification-payload'
import { shopifyWebhookOrderGid } from '@/lib/shopify/webhook-order-id'

import {
  findCommerceOrder,
  shopifyWebhookOrderTags,
} from './fulfillment'
import {
  VACHAT_ORDER_TAG,
  WHATSAPP_COMMERCE_DISPLAY_TAG,
  WHATSAPP_COMMERCE_TAG,
} from './shopify-order'

const WA_COMMERCE_REFERENCE_TAG = /^wac_/

export function isWhatsAppCommerceShopifyOrder(tags: string[]): boolean {
  return tags.some(
    (tag) =>
      tag === WHATSAPP_COMMERCE_TAG ||
      tag === WHATSAPP_COMMERCE_DISPLAY_TAG ||
      tag === VACHAT_ORDER_TAG ||
      WA_COMMERCE_REFERENCE_TAG.test(tag),
  )
}

async function markContactPaidAt(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
  column: 'wa_commerce_paid_at' | 'shopify_paid_at',
): Promise<boolean> {
  const { error } = await db
    .from('contacts')
    .update({ [column]: new Date().toISOString() })
    .eq('id', contactId)
    .eq('account_id', accountId)
    .is(column, null)

  if (error) {
    if (isMissingDbColumn(error, column)) {
      console.warn(`[commerce] contacts.${column} column missing`)
      return false
    }
    console.error(`[commerce] mark ${column} failed:`, error)
    return false
  }
  return true
}

/** Write-once. Safe to call on payment retries. */
export async function markContactWhatsAppPaid(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  return markContactPaidAt(db, accountId, contactId, 'wa_commerce_paid_at')
}

/** Write-once. Safe to call on payment retries. */
export async function markContactShopifyPaid(
  db: SupabaseClient,
  accountId: string,
  contactId: string,
): Promise<boolean> {
  return markContactPaidAt(db, accountId, contactId, 'shopify_paid_at')
}

/**
 * Label a store-checkout buyer on Shopify `orders/paid`.
 * Skips WhatsApp-commerce orders (tagged or already in the ledger)
 * and never creates a contact just to apply the label.
 */
export async function markShopifyStorePaidFromWebhook(args: {
  db: SupabaseClient
  accountId: string
  body: Record<string, unknown>
}): Promise<boolean> {
  const tags = shopifyWebhookOrderTags(args.body)
  if (isWhatsAppCommerceShopifyOrder(tags)) return false

  const orderName =
    typeof args.body.name === 'string' ? args.body.name : null
  const commerce = await findCommerceOrder(args.db, args.accountId, {
    shopifyOrderId: shopifyWebhookOrderGid(args.body),
    shopifyOrderName: orderName,
    tags,
  })
  if (commerce) return false

  const phone = firstValidShopifyPhone(args.body)
  if (!phone) return false

  const contact = await findExistingContact(args.db, args.accountId, phone)
  if (!contact) return false

  return markContactShopifyPaid(args.db, args.accountId, contact.id)
}
