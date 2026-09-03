import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  refundWhatsAppPayment,
  sendOrderStatusMessage,
  type WhatsAppOrderStatus,
} from '@/lib/whatsapp/meta-api'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import { WHATSAPP_COMMERCE_TAG } from './shopify-order'
import {
  canTransitionOrderStatus,
  isCancelAfterPay,
  shopifyFulfillmentToStatus,
  toWhatsAppOrderStatus,
} from './order-status'
import { paiseFromMajor } from './money'
import type { CommerceOrderStatus } from './types'

function tagsOf(body: Record<string, unknown>): string[] {
  const tags = body.tags
  if (typeof tags === 'string') {
    return tags.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean)
  }
  if (Array.isArray(tags)) {
    return tags.map((t) => String(t).trim()).filter(Boolean)
  }
  return []
}

function shopifyOrderGid(body: Record<string, unknown>): string {
  const gid = body.admin_graphql_api_id
  if (typeof gid === 'string' && gid.includes('Order')) return gid
  const id = body.id ?? body.order_id
  if (id == null) return ''
  const raw = String(id)
  if (raw.startsWith('gid://')) return raw
  return `gid://shopify/Order/${raw}`
}

export async function syncWhatsAppOrderFromShopify(args: {
  db: SupabaseClient
  accountId: string
  topic: string
  body: Record<string, unknown>
}): Promise<void> {
  const tags = tagsOf(args.body)
  const orderGid = shopifyOrderGid(args.body)
  const orderName =
    typeof args.body.name === 'string' ? args.body.name : null

  const commerce = await findCommerceOrder(args.db, args.accountId, {
    shopifyOrderId: orderGid,
    shopifyOrderName: orderName,
    tags,
  })
  if (!commerce) return

  if (args.topic === 'refunds/create') {
    await refundCapturedOrder(args.db, args.accountId, commerce, args.body)
    return
  }

  if (
    args.topic === 'fulfillments/create' ||
    args.topic === 'fulfillments/update' ||
    args.topic === 'fulfillment_events/create'
  ) {
    const next = shopifyFulfillmentToStatus(
      String(args.body.status ?? args.body.shipment_status ?? ''),
      String(args.body.shipment_status ?? ''),
    )
    if (next) await transitionWhatsAppOrder(args.db, args.accountId, commerce, next)
  }
}

async function findCommerceOrder(
  db: SupabaseClient,
  accountId: string,
  keys: {
    shopifyOrderId: string
    shopifyOrderName: string | null
    tags: string[]
  },
) {
  if (keys.shopifyOrderId) {
    const { data, error } = await db
      .from('whatsapp_commerce_orders')
      .select(
        'id, status, reference_id, payment_config_id, conversation_id, contact_id, total_value',
      )
      .eq('account_id', accountId)
      .eq('shopify_order_id', keys.shopifyOrderId)
      .maybeSingle()
    if (!error && data) return data
    if (error && isMissingDbRelation(error, 'whatsapp_commerce_orders')) return null
  }
  const referenceFromTag = keys.tags.find((t) => /^wac_/.test(t))
  if (referenceFromTag) {
    const { data } = await db
      .from('whatsapp_commerce_orders')
      .select(
        'id, status, reference_id, payment_config_id, conversation_id, contact_id, total_value',
      )
      .eq('account_id', accountId)
      .eq('reference_id', referenceFromTag)
      .maybeSingle()
    if (data) return data
  }
  if (keys.tags.includes(WHATSAPP_COMMERCE_TAG) && keys.shopifyOrderName) {
    const { data } = await db
      .from('whatsapp_commerce_orders')
      .select(
        'id, status, reference_id, payment_config_id, conversation_id, contact_id, total_value',
      )
      .eq('account_id', accountId)
      .eq('shopify_order_name', keys.shopifyOrderName)
      .maybeSingle()
    if (data) return data
  }
  return null
}

async function transitionWhatsAppOrder(
  db: SupabaseClient,
  accountId: string,
  commerce: {
    id: string
    status: string
    reference_id: string
    conversation_id: string | null
    contact_id: string | null
  },
  next: CommerceOrderStatus,
): Promise<void> {
  const from = commerce.status as CommerceOrderStatus
  if (!canTransitionOrderStatus(from, next)) return
  if (isCancelAfterPay(from, next)) return
  const waStatus = toWhatsAppOrderStatus(next)
  if (!waStatus) return

  await db
    .from('whatsapp_commerce_orders')
    .update({ status: next })
    .eq('id', commerce.id)

  await sendStatusToCustomer(db, accountId, commerce, waStatus)
}

async function refundCapturedOrder(
  db: SupabaseClient,
  accountId: string,
  commerce: {
    id: string
    status: string
    reference_id: string
    payment_config_id: string | null
    total_value: number | null
  },
  body: Record<string, unknown>,
): Promise<void> {
  const settings = await loadCommerceSettings(db, accountId)
  const configName =
    commerce.payment_config_id?.trim() ||
    settings.waPaymentConfigurationName?.trim()
  if (!configName) return

  const amount = refundPaise(body, Number(commerce.total_value) || 0)
  const wa = await loadWhatsAppCreds(db, accountId)
  if (!wa) return
  try {
    await refundWhatsAppPayment({
      phoneNumberId: wa.phoneNumberId,
      accessToken: wa.token,
      referenceId: commerce.reference_id,
      paymentConfigId: configName,
      valuePaise: amount,
    })
  } catch (err) {
    console.error('[commerce] payments_refund failed:', err)
  }
}

function refundPaise(body: Record<string, unknown>, fallback: number): number {
  const transactions = body.transactions
  if (Array.isArray(transactions)) {
    let sum = 0
    for (const row of transactions) {
      if (!row || typeof row !== 'object') continue
      const amount = (row as { amount?: string | number }).amount
      sum += paiseFromMajor(amount)
    }
    if (sum > 0) return sum
  }
  return Math.max(1, fallback)
}

async function sendStatusToCustomer(
  db: SupabaseClient,
  accountId: string,
  commerce: {
    reference_id: string
    conversation_id: string | null
    contact_id: string | null
  },
  status: WhatsAppOrderStatus,
): Promise<void> {
  if (!commerce.contact_id) return
  const { data: contact } = await db
    .from('contacts')
    .select('phone')
    .eq('id', commerce.contact_id)
    .maybeSingle()
  const phone = typeof contact?.phone === 'string' ? contact.phone : ''
  if (!phone) return
  const wa = await loadWhatsAppCreds(db, accountId)
  if (!wa) return
  const body =
    status === 'shipped' || status === 'partially_shipped'
      ? 'Your order is on the way.'
      : status === 'completed'
        ? 'Your order has been delivered.'
        : 'Order update'
  try {
    await sendOrderStatusMessage({
      phoneNumberId: wa.phoneNumberId,
      accessToken: wa.token,
      to: phone,
      referenceId: commerce.reference_id,
      status,
      bodyText: body,
    })
  } catch (err) {
    console.error('[commerce] order_status send failed:', err)
  }
}

async function loadWhatsAppCreds(
  db: SupabaseClient,
  accountId: string,
): Promise<{ token: string; phoneNumberId: string } | null> {
  const { data } = await db
    .from('whatsapp_config')
    .select('access_token, phone_number_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (!data?.access_token || !data.phone_number_id) return null
  try {
    return {
      token: decrypt(data.access_token as string),
      phoneNumberId: String(data.phone_number_id),
    }
  } catch {
    return null
  }
}
