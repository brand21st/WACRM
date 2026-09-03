import type { SupabaseClient } from '@supabase/supabase-js'
import { loadCommerceSettings } from '@/lib/shopify/commerce-config'
import { isMissingDbRelation } from '@/lib/shopify/config-db'
import {
  engineSendAddressMessage,
  engineSendOrderDetails,
  engineSendText,
} from '@/lib/flows/meta-send'
import type { AddressMessageValues } from '@/lib/whatsapp/meta-api'
import { buildOrderDetailsInteractive } from './order-details'
import { newCommerceReferenceId } from './money'
import { nativeCommerceEnabled } from './types'
import type { CommerceBeneficiary, MappedCartLine } from './types'
import { parseInboundOrderMessage } from './inbound-order'
import { mapCartLinesToShopify } from './map-lines'
import {
  ADDRESS_PROMPT,
  parseBeneficiaryFromText,
  resolveBeneficiary,
} from './beneficiary'
import {
  ADDRESS_FORM_BODY,
  addressFormValuesFromBeneficiary,
  parseAddressMessageReply,
} from './address-form'
import { isCompleteBeneficiary } from './order-details'

export async function handleInboundWhatsAppOrder(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  contactPhone: string | null
  contactName: string | null
  message: { order?: unknown }
}): Promise<'billed' | 'awaiting_address' | 'skipped'> {
  const parsed = parseInboundOrderMessage(args.message)
  if (!parsed) return 'skipped'

  const settings = await loadCommerceSettings(args.db, args.accountId)
  if (!nativeCommerceEnabled(settings)) return 'skipped'

  const { lines, missing } = await mapCartLinesToShopify(
    args.db,
    args.accountId,
    parsed.items,
    settings.retailerIdSource,
  )
  if (missing.length > 0 || lines.length === 0) {
    await insertInboxNote(
      args.db,
      args.conversationId,
      `WhatsApp cart could not be mapped to Shopify (${missing.join(', ') || 'no items'}). Send the bill manually.`,
    )
    return 'skipped'
  }

  const beneficiary = await resolveBeneficiary({
    db: args.db,
    accountId: args.accountId,
    contactPhone: args.contactPhone,
    contactName: args.contactName,
    settingsDefault: settings.shipBeneficiary,
  })

  const referenceId = newCommerceReferenceId()
  const total = lines.reduce((sum, line) => sum + line.amountPaise * line.quantity, 0)
  const inserted = await insertCommerceOrder(args.db, {
    accountId: args.accountId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    referenceId,
    catalogId: settings.metaCatalogId,
    total,
    lines,
    beneficiary,
    paymentConfigId: settings.waPaymentConfigurationName,
    awaitingAddress: !beneficiary,
  })
  if (!inserted) return 'skipped'

  if (!beneficiary) {
    await askForDeliveryAddress({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      values: addressFormValuesFromBeneficiary(null, args.contactPhone),
    })
    return 'awaiting_address'
  }

  const sent = await sendCommerceBill({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    referenceId,
    catalogId: settings.metaCatalogId!,
    configurationName: settings.waPaymentConfigurationName!,
    lines,
    beneficiary,
  })
  return sent ? 'billed' : 'skipped'
}

/**
 * Ask for the delivery address using WhatsApp's native India address
 * form, falling back to the plain-text prompt when the form can't be
 * sent (non-India numbers, older API versions, a Meta rejection). The
 * form gives us structured fields instead of parsing free text, so it's
 * always the first attempt.
 */
async function askForDeliveryAddress(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  values?: AddressMessageValues
  validationErrors?: AddressMessageValues
}): Promise<void> {
  try {
    await engineSendAddressMessage({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      bodyText: ADDRESS_FORM_BODY,
      values: args.values,
      validationErrors: args.validationErrors,
      aiGenerated: true,
    })
    return
  } catch (err) {
    console.warn('[commerce] address form send failed, using text prompt:', err)
  }
  await sendAddressTextPrompt(args)
}

async function sendAddressTextPrompt(args: {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
}): Promise<void> {
  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      text: ADDRESS_PROMPT,
      aiGenerated: true,
    })
  } catch (err) {
    console.error('[commerce] address prompt failed:', err)
  }
}

/**
 * Handle a submitted native address form (`nfm_reply`). Returns false
 * when this conversation has no order waiting on an address, so the
 * caller can treat the message as an ordinary inbound one.
 *
 * A form that fails server-side validation is re-sent with the
 * customer's own answers as prefill plus inline errors, per Meta's
 * recommended validation loop.
 */
export async function completeCommerceAddressFromForm(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  responseJson: unknown
}): Promise<boolean> {
  const pending = await loadAwaitingAddressOrder(
    args.db,
    args.accountId,
    args.conversationId,
  )
  if (!pending) return false

  const submission = parseAddressMessageReply(args.responseJson)
  if (!submission) return false

  if (!submission.beneficiary) {
    await askForDeliveryAddress({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      values: submission.values,
      validationErrors: submission.validationErrors,
    })
    return true
  }

  const settings = await loadCommerceSettings(args.db, args.accountId)
  if (!nativeCommerceEnabled(settings)) return false
  const lines = (pending.line_items as MappedCartLine[]) ?? []
  if (lines.length === 0) return false

  await args.db
    .from('whatsapp_commerce_orders')
    .update({ beneficiary: submission.beneficiary, awaiting_address: false })
    .eq('id', pending.id)

  return sendCommerceBill({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    referenceId: pending.reference_id,
    catalogId: settings.metaCatalogId!,
    configurationName: settings.waPaymentConfigurationName!,
    lines,
    beneficiary: submission.beneficiary,
  })
}

/**
 * Recover when an address form we sent was never rendered — Meta reports
 * error 1026 (receiver incapable) as a `failed` status, and the customer
 * sees nothing at all. Re-asks with the plain-text prompt so checkout
 * isn't silently stuck.
 */
export async function handleAddressFormDeliveryFailure(args: {
  db: SupabaseClient
  phoneNumberId: string
  messageId: string
}): Promise<void> {
  const { data: config } = await args.db
    .from('whatsapp_config')
    .select('account_id, user_id')
    .eq('phone_number_id', args.phoneNumberId)
    .maybeSingle()
  if (!config?.account_id || !config.user_id) return

  const { data: message } = await args.db
    .from('messages')
    .select('conversation_id')
    .eq('message_id', args.messageId)
    .eq('interactive_payload->>kind', 'address_message')
    .maybeSingle()
  if (!message?.conversation_id) return

  const conversationId = message.conversation_id as string
  const pending = await loadAwaitingAddressOrder(
    args.db,
    config.account_id as string,
    conversationId,
  )
  if (!pending) return

  const { data: conversation } = await args.db
    .from('conversations')
    .select('contact_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation?.contact_id) return

  await sendAddressTextPrompt({
    accountId: config.account_id as string,
    userId: config.user_id as string,
    conversationId,
    contactId: conversation.contact_id as string,
  })
}

export async function tryCompleteCommerceAddress(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  contactName: string | null
  text: string
}): Promise<boolean> {
  const pending = await loadAwaitingAddressOrder(args.db, args.accountId, args.conversationId)
  if (!pending) return false

  const beneficiary = parseBeneficiaryFromText(args.text, args.contactName)
  if (!beneficiary) {
    await sendAddressTextPrompt({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
    })
    return true
  }

  const settings = await loadCommerceSettings(args.db, args.accountId)
  if (!nativeCommerceEnabled(settings)) return false
  const lines = (pending.line_items as MappedCartLine[]) ?? []
  if (lines.length === 0) return false

  await args.db
    .from('whatsapp_commerce_orders')
    .update({ beneficiary, awaiting_address: false })
    .eq('id', pending.id)

  return sendCommerceBill({
    db: args.db,
    accountId: args.accountId,
    userId: args.userId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    referenceId: pending.reference_id,
    catalogId: settings.metaCatalogId!,
    configurationName: settings.waPaymentConfigurationName!,
    lines,
    beneficiary,
  })
}

async function sendCommerceBill(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  referenceId: string
  catalogId: string
  configurationName: string
  lines: MappedCartLine[]
  beneficiary: CommerceBeneficiary
}): Promise<boolean> {
  if (!isCompleteBeneficiary(args.beneficiary)) return false
  try {
    const built = buildOrderDetailsInteractive({
      referenceId: args.referenceId,
      catalogId: args.catalogId,
      configurationName: args.configurationName,
      accountId: args.accountId,
      bodyText: 'Review and pay for your order',
      items: args.lines.map((line) => ({
        retailer_id: line.retailer_id,
        name: line.name,
        quantity: line.quantity,
        amountPaise: line.amountPaise,
      })),
      beneficiary: args.beneficiary,
    })
    await engineSendOrderDetails({
      accountId: args.accountId,
      userId: args.userId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      bodyText: 'Review and pay for your order',
      referenceId: args.referenceId,
      catalogId: args.catalogId,
      interactive: built.interactive,
      aiGenerated: true,
    })
    return true
  } catch (err) {
    console.error('[commerce] send order_details failed:', err)
    await insertInboxNote(
      args.db,
      args.conversationId,
      `Could not send WhatsApp bill (${args.referenceId}): ${err instanceof Error ? err.message : String(err)}`,
    )
    return false
  }
}

async function insertCommerceOrder(
  db: SupabaseClient,
  row: {
    accountId: string
    contactId: string
    conversationId: string
    referenceId: string
    catalogId: string | null
    total: number
    lines: MappedCartLine[]
    beneficiary: CommerceBeneficiary | null
    paymentConfigId: string | null
    awaitingAddress: boolean
  },
): Promise<boolean> {
  const { error } = await db.from('whatsapp_commerce_orders').insert({
    account_id: row.accountId,
    contact_id: row.contactId,
    conversation_id: row.conversationId,
    reference_id: row.referenceId,
    catalog_id: row.catalogId,
    status: 'pending',
    currency: 'INR',
    total_value: row.total,
    line_items: row.lines,
    beneficiary: row.beneficiary,
    payment_config_id: row.paymentConfigId,
    awaiting_address: row.awaitingAddress,
  })
  if (error) {
    if (isMissingDbRelation(error, 'whatsapp_commerce_orders')) {
      console.warn('[commerce] whatsapp_commerce_orders table missing')
      return false
    }
    console.error('[commerce] insert order failed:', error)
    return false
  }
  return true
}

async function loadAwaitingAddressOrder(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
) {
  const { data, error } = await db
    .from('whatsapp_commerce_orders')
    .select('id, reference_id, line_items')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('awaiting_address', true)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (isMissingDbRelation(error, 'whatsapp_commerce_orders')) return null
    console.warn('[commerce] load awaiting address failed:', error)
    return null
  }
  return data
}

export async function insertInboxNote(
  db: SupabaseClient,
  conversationId: string,
  text: string,
): Promise<void> {
  const { error } = await db.from('messages').insert({
    conversation_id: conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text.slice(0, 1024),
    status: 'delivered',
  })
  if (error) {
    console.warn('[commerce] inbox note failed:', error)
  }
}
