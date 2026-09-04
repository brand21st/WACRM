import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  lookupWhatsAppPayment,
  sendOrderStatusMessage,
  type PaymentLookupResult,
} from '@/lib/whatsapp/meta-api'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import { engineSendOrderStatus, engineSendText } from '@/lib/flows/meta-send'
import { createPaidShopifyOrder } from './shopify-order'
import {
  ORDER_CONFIRMED_BODY,
  PAYMENT_RECEIVED_BODY,
  canTransitionOrderStatus,
  orderConfirmedText,
} from './order-status'
import { sanitizeReferenceId, sanitizeWebhookText } from './sanitize'
import { insertInboxNote } from './checkout'
import type { CommerceBeneficiary, MappedCartLine } from './types'
import type { AppliedCommerceDiscount } from './shopify-discount'

export interface WhatsAppPaymentStatus {
  id?: string
  status?: string
  timestamp?: string
  recipient_id?: string
  type?: string
  payment?: {
    reference_id?: string
    transaction?: {
      id?: string
      pg_transaction_id?: string
      type?: string
      status?: string
      method?: { type?: string }
    }
  }
}

export function isPaymentStatus(status: {
  type?: string
}): boolean {
  return status.type === 'payment'
}

export async function handleWhatsAppPaymentStatus(args: {
  db: SupabaseClient
  phoneNumberId: string
  status: WhatsAppPaymentStatus
}): Promise<void> {
  const referenceId = sanitizeReferenceId(args.status.payment?.reference_id)
  if (!referenceId) return

  const { data: waConfig, error: waErr } = await args.db
    .from('whatsapp_config')
    .select('account_id, user_id, access_token, phone_number_id')
    .eq('phone_number_id', args.phoneNumberId)
    .maybeSingle()
  if (waErr || !waConfig?.account_id || !waConfig.access_token) return

  const accountId = waConfig.account_id as string
  const order = await loadCommerceOrder(args.db, accountId, referenceId)
  if (!order) return
  if (order.status !== 'pending') return

  const settings = await loadCommerceSettings(args.db, accountId)
  const configurationName = settings.waPaymentConfigurationName?.trim()
  if (!configurationName) return

  let lookup: PaymentLookupResult | null = null
  try {
    lookup = await lookupWhatsAppPayment({
      phoneNumberId: args.phoneNumberId,
      accessToken: decrypt(waConfig.access_token as string),
      configurationName,
      referenceId,
    })
  } catch (err) {
    console.error('[commerce] payment lookup failed:', err)
    return
  }
  if (!lookup || lookup.status !== 'captured') {
    const failed = lookup?.transactions.find((t) => t.status === 'failed')
    if (failed && order.conversation_id) {
      await insertInboxNote(
        args.db,
        order.conversation_id,
        `WhatsApp payment attempt failed for ${referenceId}${failed.status ? '' : ''}. Customer can retry on the same bill.`,
      )
    }
    return
  }

  const success =
    lookup.transactions.find((t) => t.status === 'success' || t.status === 'captured') ??
    lookup.transactions[0]
  const txn = {
    id: sanitizeWebhookText(success?.id ?? args.status.payment?.transaction?.id, 80),
    pg_transaction_id: sanitizeWebhookText(
      success?.pg_transaction_id ?? args.status.payment?.transaction?.pg_transaction_id,
      80,
    ),
    type: sanitizeWebhookText(success?.type ?? 'razorpay', 40),
    status: 'success',
    method: sanitizeWebhookText(success?.method?.type, 40),
  }

  if (!canTransitionOrderStatus('pending', 'processing')) return

  await args.db
    .from('whatsapp_commerce_orders')
    .update({
      status: 'processing',
      payment_id: txn.id || null,
      razorpay_order_id: txn.id || null,
      razorpay_payment_id: txn.pg_transaction_id || null,
      pg_transaction: txn,
    })
    .eq('id', order.id)
    .eq('status', 'pending')

  // Create the paid Shopify order before telling the customer their
  // order is confirmed, so the confirmation can carry the real order
  // number and never claims more than actually happened.
  const shopifyOrderName = await createShopifyOrderForPayment({
    db: args.db,
    accountId,
    referenceId,
    order,
  })

  await sendPaymentConfirmation({
    accountId,
    userId: typeof waConfig.user_id === 'string' ? waConfig.user_id : null,
    conversationId:
      typeof order.conversation_id === 'string' ? order.conversation_id : null,
    contactId: typeof order.contact_id === 'string' ? order.contact_id : null,
    phoneNumberId: args.phoneNumberId,
    accessToken: waConfig.access_token as string,
    recipientId: args.status.recipient_id || '',
    referenceId,
    shopifyOrderName,
  })
}

/**
 * Create the paid Shopify order. Returns its name (`#1001`) so the chat
 * confirmation can quote it, or null when Shopify is unreachable,
 * unmapped, or rejects the order — each of which leaves an inbox note
 * for an agent to finish by hand.
 */
async function createShopifyOrderForPayment(args: {
  db: SupabaseClient
  accountId: string
  referenceId: string
  order: {
    id: unknown
    conversation_id?: unknown
    contact_id?: unknown
    line_items?: unknown
    beneficiary?: unknown
    total_value?: unknown
    discount_code?: unknown
    discount_value?: unknown
    discount_percent?: unknown
  }
}): Promise<string | null> {
  const conversationId =
    typeof args.order.conversation_id === 'string' ? args.order.conversation_id : null

  const shopify = await loadShopifyConfig(args.db, args.accountId, {
    requireActive: false,
  })
  if (!shopify) {
    if (conversationId) {
      await insertInboxNote(
        args.db,
        conversationId,
        `Payment captured for ${args.referenceId} but Shopify is not connected. Create the order manually.`,
      )
    }
    return null
  }

  const lines = (args.order.line_items as MappedCartLine[]) ?? []
  const unmapped = lines.filter((line) => !line.variantId)
  if (unmapped.length > 0) {
    if (conversationId) {
      await insertInboxNote(
        args.db,
        conversationId,
        `Payment captured for ${args.referenceId} but Shopify mapping failed for ${unmapped.map((l) => l.retailer_id).join(', ')}. Complete the order manually.`,
      )
    }
    return null
  }

  let phone: string | null = null
  if (typeof args.order.contact_id === 'string') {
    const { data: contact } = await args.db
      .from('contacts')
      .select('phone')
      .eq('id', args.order.contact_id)
      .maybeSingle()
    phone = typeof contact?.phone === 'string' ? contact.phone : null
  }

  try {
    const created = await createPaidShopifyOrder({
      config: shopify,
      referenceId: args.referenceId,
      phone,
      beneficiary: (args.order.beneficiary as CommerceBeneficiary) ?? null,
      lines,
      totalPaise: Number(args.order.total_value) || 0,
      discount: commerceDiscountFromOrder(args.order),
    })
    await args.db
      .from('whatsapp_commerce_orders')
      .update({
        shopify_order_id: created.id,
        shopify_order_name: created.name,
      })
      .eq('id', args.order.id)
    return created.name
  } catch (err) {
    console.error('[commerce] Shopify orderCreate failed:', err)
    if (conversationId) {
      await insertInboxNote(
        args.db,
        conversationId,
        `Payment captured for ${args.referenceId} but Shopify order create failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
    return null
  }
}

/**
 * Confirm the order in chat: update the Review & Pay card through an
 * `order_status` message, then follow with the Shopify order number.
 *
 * Both go through the engine senders so the messages also land in the
 * WACRM inbox. Without a conversation/contact/user to attribute them to
 * we fall back to a raw Graph send — the customer still hears back, the
 * inbox just misses the copy.
 */
async function sendPaymentConfirmation(args: {
  accountId: string
  userId: string | null
  conversationId: string | null
  contactId: string | null
  phoneNumberId: string
  accessToken: string
  recipientId: string
  referenceId: string
  shopifyOrderName: string | null
}): Promise<void> {
  const bodyText = args.shopifyOrderName
    ? ORDER_CONFIRMED_BODY
    : PAYMENT_RECEIVED_BODY

  if (args.userId && args.conversationId && args.contactId) {
    try {
      await engineSendOrderStatus({
        accountId: args.accountId,
        userId: args.userId,
        conversationId: args.conversationId,
        contactId: args.contactId,
        bodyText,
        referenceId: args.referenceId,
        status: 'processing',
        aiGenerated: true,
      })
    } catch (err) {
      console.error('[commerce] order_status confirmation failed:', err)
    }

    // The card alone doesn't carry the order number, and Shopify's own
    // receipt is off for WhatsApp orders — so the number arrives here.
    if (args.shopifyOrderName) {
      try {
        await engineSendText({
          accountId: args.accountId,
          userId: args.userId,
          conversationId: args.conversationId,
          contactId: args.contactId,
          text: orderConfirmedText(args.shopifyOrderName),
          aiGenerated: true,
        })
      } catch (err) {
        console.error('[commerce] order confirmation text failed:', err)
      }
    }
    return
  }

  try {
    await sendOrderStatusMessage({
      phoneNumberId: args.phoneNumberId,
      accessToken: decrypt(args.accessToken),
      to: args.recipientId,
      referenceId: args.referenceId,
      status: 'processing',
      bodyText,
    })
  } catch (err) {
    console.error('[commerce] order_status confirmation failed:', err)
  }
}

async function loadCommerceOrder(
  db: SupabaseClient,
  accountId: string,
  referenceId: string,
) {
  const { data, error } = await db
    .from('whatsapp_commerce_orders')
    .select(
      'id, status, conversation_id, contact_id, line_items, beneficiary, total_value, shopify_order_id, discount_code, discount_value, discount_percent',
    )
    .eq('account_id', accountId)
    .eq('reference_id', referenceId)
    .maybeSingle()
  if (error) {
    if (isMissingDbRelation(error, 'whatsapp_commerce_orders')) return null
    console.error('[commerce] load order failed:', error)
    return null
  }
  return data
}

function commerceDiscountFromOrder(order: {
  discount_code?: unknown
  discount_value?: unknown
  discount_percent?: unknown
}): AppliedCommerceDiscount | null {
  const code = typeof order.discount_code === 'string' ? order.discount_code.trim() : ''
  const amountPaise = Math.max(0, Math.round(Number(order.discount_value) || 0))
  if (!code || amountPaise <= 0) return null
  const percentRaw = Number(order.discount_percent)
  const percent = Number.isFinite(percentRaw) && percentRaw > 0 ? percentRaw : null
  return {
    code,
    kind: percent != null ? 'percentage' : 'fixed',
    percent,
    amountPaise,
  }
}
