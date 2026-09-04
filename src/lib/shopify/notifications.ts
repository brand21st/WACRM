import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import {
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import {
  resolveTemplateRow,
  templateContentText,
} from '@/lib/whatsapp/template-body'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import type { MessageTemplate } from '@/types'

import { shopifyGraphql, shopifyRest } from './client'
import { loadShopifyConfig } from './config'
import { shopifyWebhookOrderNumericId } from './webhook-order-id'
import {
  attachShopContext,
  notificationActionsForTopic,
  orderFields,
  urlPartial,
  withUrlPartials,
  type NotificationAction,
} from './notification-payload'
import {
  buildBodyParams,
  DEFAULT_DAYS_AFTER,
  DEFAULT_DELAY_HOURS,
  isShopifyNotificationTrigger,
  mergeRules,
  type ShopifyNotificationRule,
  type ShopifyNotificationTrigger,
} from './notification-triggers'
import {
  canEnableShopifyTemplate,
  rulesMissingApprovedPresets,
} from './notification-templates'

const FULFILLMENT_ENRICH_QUERY = `
query NotificationFulfillment($id: ID!) {
  fulfillment(id: $id) {
    trackingInfo { number url company }
    order {
      id
      name
      email
      phone
      customer { firstName lastName phone }
      shippingAddress { phone firstName lastName }
    }
  }
}
`

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

async function loadRules(
  db: SupabaseClient,
  accountId: string,
): Promise<ShopifyNotificationRule[]> {
  const { data, error } = await db
    .from('shopify_notification_rules')
    .select(
      'trigger_key, is_enabled, template_name, template_language, variable_map, config',
    )
    .eq('account_id', accountId)
  if (error) {
    console.error('[shopify/notifications] load rules failed:', error)
    return mergeRules([])
  }
  const rows = (data ?? []) as Partial<ShopifyNotificationRule>[]
  const autoBound = await persistApprovedStatusRules(db, accountId, rows)
  return mergeRules([...rows, ...autoBound])
}

async function persistApprovedStatusRules(
  db: SupabaseClient,
  accountId: string,
  rows: Partial<ShopifyNotificationRule>[],
): Promise<ShopifyNotificationRule[]> {
  const { data: templates, error } = await db
    .from('message_templates')
    .select('name, language, status')
    .eq('account_id', accountId)
    .eq('status', 'APPROVED')
  if (error || !templates?.length) return []

  const missing = rulesMissingApprovedPresets(
    rows.map((row) => row.trigger_key ?? ''),
    templates.filter((row) => canEnableShopifyTemplate(row.status)),
  )
  if (missing.length === 0) return []

  const { error: insertError } = await db.from('shopify_notification_rules').insert(
    missing.map((rule) => ({
      account_id: accountId,
      trigger_key: rule.trigger_key,
      is_enabled: rule.is_enabled,
      template_name: rule.template_name,
      template_language: rule.template_language,
      variable_map: rule.variable_map,
      config: rule.config,
    })),
  )
  if (insertError) {
    console.warn('[shopify/notifications] auto-bind rules failed:', insertError)
    return missing
  }
  return missing
}

function ruleFor(
  rules: ShopifyNotificationRule[],
  trigger: ShopifyNotificationTrigger,
): ShopifyNotificationRule | undefined {
  return rules.find((r) => r.trigger_key === trigger)
}

function hintsFrom(rules: ShopifyNotificationRule[]) {
  const abandoned = ruleFor(rules, 'checkout_abandoned')
  const after = ruleFor(rules, 'after_delivered')
  return {
    delayHours: Number(abandoned?.config.delay_hours) || DEFAULT_DELAY_HOURS,
    daysAfter: Number(after?.config.days_after) || DEFAULT_DAYS_AFTER,
    discountCode: String(abandoned?.config.discount_code ?? ''),
  }
}

async function enrichFields(
  db: SupabaseClient,
  accountId: string,
  topic: string,
  body: Record<string, unknown>,
  fields: Record<string, string>,
): Promise<Record<string, string>> {
  const needsPhone = !fields.phone?.trim()
  const needsOrderName =
    !fields.order_name?.trim() || /^\d+$/.test(fields.order_name)
  const skipOrderFetch =
    !needsPhone &&
    (topic === 'checkouts/create' || topic === 'checkouts/update')
  const skipRest = skipOrderFetch || (!needsPhone && !needsOrderName)

  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  let next = fields

  if (config && !skipRest) {
    const orderId =
      fields.order_id ||
      shopifyWebhookOrderNumericId(body) ||
      String(body.order_id ?? '')
    if (orderId) {
      try {
        const data = await shopifyRest<{ order?: Record<string, unknown> }>({
          shopDomain: config.shopDomain,
          accessToken: config.accessToken,
          path: `/orders/${orderId}.json`,
        })
        if (data.order) {
          next = mergeEnriched(next, orderFields(data.order))
        }
      } catch (err) {
        console.warn('[shopify/notifications] order enrich failed:', err)
      }
    }

    if (topic === 'fulfillment_events/create' || topic.startsWith('fulfillments/')) {
      const fulfillmentId = String(body.fulfillment_id ?? body.id ?? '')
      if (fulfillmentId) {
        try {
          const data = await shopifyGraphql<{
            fulfillment?: {
              trackingInfo?: { number?: string; url?: string; company?: string }[]
              order?: Record<string, unknown>
            } | null
          }>({
            shopDomain: config.shopDomain,
            accessToken: config.accessToken,
            query: FULFILLMENT_ENRICH_QUERY,
            variables: { id: `gid://shopify/Fulfillment/${fulfillmentId}` },
          })
          const order = data.fulfillment?.order
          const tracking = data.fulfillment?.trackingInfo?.[0]
          const extra = order ? orderFields(order) : {}
          if (tracking) {
            extra.tracking_number = tracking.number ?? extra.tracking_number ?? ''
            extra.tracking_url = tracking.url ?? extra.tracking_url ?? ''
            extra.tracking_company = tracking.company ?? extra.tracking_company ?? ''
          }
          next = mergeEnriched(next, extra)
        } catch (err) {
          console.warn('[shopify/notifications] fulfillment enrich failed:', err)
        }
      }
    }
  }

  if (config) {
    return attachShopContext(next, {
      shopName: config.shopName,
      currency: config.currency,
    })
  }
  return withUrlPartials(next)
}

function mergeEnriched(
  fields: Record<string, string>,
  extra: Record<string, string>,
): Record<string, string> {
  return {
    ...extra,
    ...fields,
    phone: fields.phone || extra.phone || '',
    customer_first_name:
      fields.customer_first_name || extra.customer_first_name || '',
    customer_name: fields.customer_name || extra.customer_name || '',
    order_name:
      fields.order_name && !/^\d+$/.test(fields.order_name)
        ? fields.order_name
        : extra.order_name || fields.order_name,
    tracking_number: fields.tracking_number || extra.tracking_number || '',
    tracking_url: fields.tracking_url || extra.tracking_url || '',
    tracking_company: fields.tracking_company || extra.tracking_company || '',
    customer_last_name:
      fields.customer_last_name || extra.customer_last_name || '',
    order_number: fields.order_number || extra.order_number || '',
    order_status_url: fields.order_status_url || extra.order_status_url || '',
    product_details: fields.product_details || extra.product_details || '',
    customer_address: fields.customer_address || extra.customer_address || '',
  }
}

async function cancelAbandonedJobs(
  db: SupabaseClient,
  accountId: string,
  cancelIds: string[],
  email?: string,
): Promise<void> {
  const ids = cancelIds.filter(Boolean)
  if (ids.length === 0 && !email) return
  const { data: rows, error } = await db
    .from('shopify_notification_jobs')
    .select('id, resource_id, payload')
    .eq('account_id', accountId)
    .eq('trigger_key', 'checkout_abandoned')
    .eq('status', 'pending')
  if (error || !rows?.length) return
  const emailNorm = (email || '').trim().toLowerCase()
  const toCancel = rows.filter((row) => {
    if (ids.includes(String(row.resource_id))) return true
    const payload = asRecord(row.payload)
    const payloadEmail = String(payload?.email ?? '').trim().toLowerCase()
    return Boolean(emailNorm && payloadEmail && payloadEmail === emailNorm)
  })
  for (const row of toCancel) {
    await db
      .from('shopify_notification_jobs')
      .update({ status: 'cancelled', error: null })
      .eq('id', row.id)
      .eq('status', 'pending')
  }
}

async function queueJob(
  db: SupabaseClient,
  accountId: string,
  action: NotificationAction,
): Promise<void> {
  const runAt = new Date(Date.now() + (action.delayMs ?? 0)).toISOString()
  const payload = { ...action.fields }
  const { data: existing } = await db
    .from('shopify_notification_jobs')
    .select('id, status')
    .eq('account_id', accountId)
    .eq('trigger_key', action.trigger)
    .eq('resource_id', action.resourceId)
    .maybeSingle()

  if (existing?.status === 'sent') return

  if (existing?.id) {
    await db
      .from('shopify_notification_jobs')
      .update({
        status: 'pending',
        run_at: runAt,
        payload,
        error: null,
      })
      .eq('id', existing.id)
    return
  }

  const { error } = await db.from('shopify_notification_jobs').insert({
    account_id: accountId,
    trigger_key: action.trigger,
    resource_id: action.resourceId,
    run_at: runAt,
    status: 'pending',
    payload,
  })
  if (error && !isUniqueViolation(error)) {
    console.error('[shopify/notifications] queue insert failed:', error)
  }
}

async function claimSend(
  db: SupabaseClient,
  accountId: string,
  trigger: string,
  resourceId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from('shopify_notification_sends')
    .insert({
      account_id: accountId,
      trigger_key: trigger,
      resource_id: resourceId,
    })
    .select('id')
    .maybeSingle()
  if (error) {
    if (isUniqueViolation(error)) return null
    console.error('[shopify/notifications] claim send failed:', error)
    return null
  }
  return data?.id ?? null
}

async function releaseSend(db: SupabaseClient, id: string): Promise<void> {
  await db.from('shopify_notification_sends').delete().eq('id', id)
}

function buttonParamsFor(
  template: MessageTemplate,
  fields: Record<string, string>,
): Record<number, string> {
  const out: Record<number, string> = {}
  const buttons = template.buttons ?? []
  buttons.forEach((button, index) => {
    if (button.type === 'COPY_CODE' && fields.discount_code) {
      out[index] = fields.discount_code
      return
    }
    if (button.type !== 'URL') return
    if (extractVariableIndices(button.url ?? '').length === 0) return
    const full =
      fields.checkout_url || fields.tracking_url || fields.order_status_url
    if (!full) return
    const partial =
      urlPartial(full) ||
      fields.checkout_url_partial ||
      fields.tracking_url_partial ||
      fields.order_status_url_partial
    out[index] = partial || full
  })
  return out
}

async function sendTemplateToPhone(
  db: SupabaseClient,
  args: {
    accountId: string
    phone: string
    name: string | null
    rule: ShopifyNotificationRule
    fields: Record<string, string>
    claimId: string
    resourceId: string
  },
): Promise<boolean> {
  const templateName = args.rule.template_name?.trim()
  if (!templateName) {
    await releaseSend(db, args.claimId)
    return false
  }

  let resolved
  try {
    resolved = await resolveConversationByPhone(
      db,
      args.accountId,
      args.phone,
      args.name,
    )
  } catch (err) {
    console.warn('[shopify/notifications] resolve contact failed:', err)
    await releaseSend(db, args.claimId)
    return false
  }

  const { data: waConfig, error: waErr } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (waErr || !waConfig?.phone_number_id || !waConfig.access_token) {
    await releaseSend(db, args.claimId)
    return false
  }

  let accessToken: string
  try {
    accessToken = decrypt(waConfig.access_token)
  } catch {
    await releaseSend(db, args.claimId)
    return false
  }

  const { row, language } = await resolveTemplateRow(
    db,
    args.accountId,
    templateName,
    args.rule.template_language,
  )
  const bodyParams = buildBodyParams(args.rule.variable_map, args.fields)
  const headerText =
    args.fields.customer_first_name || args.fields.order_name || undefined
  const messageParams = {
    body: bodyParams,
    headerText,
    buttonParams: row ? buttonParamsFor(row, args.fields) : undefined,
  }

  const sanitized = sanitizePhoneForMeta(args.phone)
  if (!isValidE164(sanitized) && !isValidE164(`+${sanitized}`)) {
    await releaseSend(db, args.claimId)
    return false
  }

  const variants = phoneVariants(sanitized)
  let waMessageId = ''
  let lastError: unknown = null
  for (const phone of variants) {
    try {
      const result = await sendTemplateMessage({
        phoneNumberId: waConfig.phone_number_id,
        accessToken,
        to: phone,
        templateName,
        language,
        template: row ?? undefined,
        messageParams,
        params: bodyParams,
      })
      waMessageId = result.messageId
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) {
        await releaseSend(db, args.claimId)
        throw err
      }
      lastError = err
    }
  }
  if (lastError || !waMessageId) {
    await releaseSend(db, args.claimId)
    return false
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: resolved.conversationId,
    sender_type: 'bot',
    content_type: 'template',
    content_text: templateContentText(row, bodyParams),
    template_name: templateName,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    console.error(
      '[shopify/notifications] sent to Meta but DB insert failed:',
      msgErr,
    )
  }

  await db
    .from('shopify_notification_sends')
    .update({
      conversation_id: resolved.conversationId,
      template_name: templateName,
    })
    .eq('id', args.claimId)

  return true
}

async function dispatchSend(
  db: SupabaseClient,
  accountId: string,
  rule: ShopifyNotificationRule,
  action: NotificationAction,
  fields: Record<string, string>,
): Promise<boolean> {
  if (!rule.is_enabled || !rule.template_name?.trim()) return false
  const phone = fields.phone?.trim()
  if (!phone) return false

  const claimId = await claimSend(
    db,
    accountId,
    action.trigger,
    action.resourceId,
  )
  if (!claimId) return false

  try {
    return await sendTemplateToPhone(db, {
      accountId,
      phone,
      name: fields.customer_name || fields.customer_first_name || null,
      rule,
      fields,
      claimId,
      resourceId: action.resourceId,
    })
  } catch (err) {
    console.error('[shopify/notifications] send failed:', err)
    await releaseSend(db, claimId)
    return false
  }
}

/**
 * Handle a Shopify order-lifecycle webhook (HMAC already verified).
 */
export async function handleShopifyNotificationWebhook(
  db: SupabaseClient,
  accountId: string,
  topic: string,
  body: Record<string, unknown>,
): Promise<void> {
  const rules = await loadRules(db, accountId)
  const actions = notificationActionsForTopic(topic, body, hintsFrom(rules))
  for (const action of actions) {
    if (action.kind === 'cancel_abandoned') {
      await cancelAbandonedJobs(
        db,
        accountId,
        action.cancelIds ?? [action.resourceId],
        action.fields.email,
      )
      continue
    }

    const rule = ruleFor(rules, action.trigger)
    if (!rule?.is_enabled || !rule.template_name?.trim()) continue

    const fields = await enrichFields(db, accountId, topic, body, action.fields)

    if (action.kind === 'queue') {
      await queueJob(db, accountId, { ...action, fields })
      continue
    }

    await dispatchSend(db, accountId, rule, action, fields)
  }
}

export async function drainShopifyNotificationJobs(
  db: SupabaseClient,
  limit = 50,
): Promise<{ processed: number }> {
  const { data: due, error } = await db
    .from('shopify_notification_jobs')
    .select('id, account_id, trigger_key, resource_id, payload')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(limit)

  if (error) throw error
  if (!due?.length) return { processed: 0 }

  let processed = 0
  for (const row of due) {
    const { data: claim } = await db
      .from('shopify_notification_jobs')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    const trigger = String(row.trigger_key)
    if (!isShopifyNotificationTrigger(trigger)) {
      await db
        .from('shopify_notification_jobs')
        .update({ status: 'failed', error: 'unknown trigger' })
        .eq('id', row.id)
      continue
    }

    const rules = await loadRules(db, row.account_id as string)
    const rule = ruleFor(rules, trigger)
    const fields = asRecord(row.payload) as Record<string, string> | null
    const ok =
      rule && fields
        ? await dispatchSend(
            db,
            row.account_id as string,
            rule,
            {
              kind: 'send',
              trigger,
              resourceId: String(row.resource_id),
              fields,
            },
            fields,
          )
        : false

    await db
      .from('shopify_notification_jobs')
      .update({
        status: ok ? 'sent' : 'failed',
        error: ok ? null : 'send skipped or failed',
      })
      .eq('id', row.id)
    processed += 1
  }

  return { processed }
}
