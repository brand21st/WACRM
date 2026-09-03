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
import { createPaidShopifyOrder } from './shopify-order'
import { canTransitionOrderStatus } from './order-status'
import { sanitizeReferenceId, sanitizeWebhookText } from './sanitize'
import { insertInboxNote } from './checkout'
import type { CommerceBeneficiary, MappedCartLine } from './types'

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
    .select('account_id, access_token, phone_number_id')
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

  try {
    await sendOrderStatusMessage({
      phoneNumberId: args.phoneNumberId,
      accessToken: decrypt(waConfig.access_token as string),
      to: args.status.recipient_id || '',
      referenceId,
      status: 'processing',
      bodyText: 'Payment received. We are processing your order.',
    })
  } catch (err) {
    console.error('[commerce] order_status processing failed:', err)
  }

  const shopify = await loadShopifyConfig(args.db, accountId, {
    requireActive: false,
  })
  if (!shopify) {
    if (order.conversation_id) {
      await insertInboxNote(
        args.db,
        order.conversation_id,
        `Payment captured for ${referenceId} but Shopify is not connected. Create the order manually.`,
      )
    }
    return
  }

  const lines = (order.line_items as MappedCartLine[]) ?? []
  const unmapped = lines.filter((line) => !line.variantId)
  if (unmapped.length > 0) {
    if (order.conversation_id) {
      await insertInboxNote(
        args.db,
        order.conversation_id,
        `Payment captured for ${referenceId} but Shopify mapping failed for ${unmapped.map((l) => l.retailer_id).join(', ')}. Complete the order manually.`,
      )
    }
    return
  }

  let phone: string | null = null
  if (order.contact_id) {
    const { data: contact } = await args.db
      .from('contacts')
      .select('phone')
      .eq('id', order.contact_id)
      .maybeSingle()
    phone = typeof contact?.phone === 'string' ? contact.phone : null
  }

  try {
    const created = await createPaidShopifyOrder({
      config: shopify,
      referenceId,
      phone,
      beneficiary: (order.beneficiary as CommerceBeneficiary) ?? null,
      lines,
      totalPaise: Number(order.total_value) || 0,
    })
    await args.db
      .from('whatsapp_commerce_orders')
      .update({
        shopify_order_id: created.id,
        shopify_order_name: created.name,
      })
      .eq('id', order.id)
  } catch (err) {
    console.error('[commerce] Shopify orderCreate failed:', err)
    if (order.conversation_id) {
      await insertInboxNote(
        args.db,
        order.conversation_id,
        `Payment captured for ${referenceId} but Shopify order create failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
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
      'id, status, conversation_id, contact_id, line_items, beneficiary, total_value, shopify_order_id',
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
