import { requireApiKey } from '@/lib/auth/api-context'
import { hasScope } from '@/lib/api-keys/scopes'
import { fail, ok, toApiErrorResponse } from '@/lib/api/v1/respond'
import { isUniqueViolation } from '@/lib/contacts/dedupe'
import {
  POSTBUS_CONFIG_COLUMNS,
  isGlobalPostBusMode,
  isPostBusNotificationEvent,
  parseNotificationSettings,
  templateNameForEvent,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import { postbusTemplateBodyParams } from '@/lib/postbus/template-params'
import { accountHasWhatsAppConfig } from '@/lib/postbus/readiness'
import { isValidE164, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation'
import {
  sendMessageToConversation,
  SendMessageError,
} from '@/lib/whatsapp/send-message'

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key]
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * POST /api/postbus/notifications
 *
 * PostBus → Vachat WhatsApp send. Auth is a Vachat API key with
 * `messages:send` (legacy 1:1 merchant mapping) or `postbus:send`
 * (global sender). Tenant is the key's account only.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, ['messages:send', 'postbus:send'])
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400)
    }

    const merchantId = str(body, 'merchant_id')
    const notificationType = str(body, 'notification_type')
    const externalRef = str(body, 'external_ref')
    const to = str(body, 'to')

    if (!merchantId || !notificationType || !externalRef || !to) {
      return fail(
        'bad_request',
        'merchant_id, notification_type, external_ref, and to are required',
        400,
      )
    }
    if (!isPostBusNotificationEvent(notificationType)) {
      return fail('bad_request', 'Unknown notification_type', 400)
    }
    if (!isValidE164(to) && !isValidE164(sanitizePhoneForMeta(to))) {
      return fail('bad_request', 'to must be a valid E.164 phone number', 400)
    }

    const { data: existing } = await ctx.supabase
      .from('postbus_notifications')
      .select(
        'id, message_id, whatsapp_message_id, conversation_id, contact_id, status',
      )
      .eq('account_id', ctx.accountId)
      .eq('external_ref', externalRef)
      .maybeSingle()

    if (existing) {
      return ok({
        duplicate: true,
        message_id: existing.message_id,
        whatsapp_message_id: existing.whatsapp_message_id,
        conversation_id: existing.conversation_id,
        contact_id: existing.contact_id,
        status: existing.status,
      })
    }

    const { data: integration, error: intErr } = await ctx.supabase
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (intErr) {
      console.error('[postbus/notifications] integration lookup:', intErr)
      return fail('internal', 'Failed to load PostBus mapping', 500)
    }

    const row = integration as unknown as PostBusIntegrationRow | null
    const global = isGlobalPostBusMode(row)
    if (!row) {
      return fail(
        'invalid_merchant_mapping',
        global
          ? 'Global PostBus integration is not configured'
          : 'merchant_id does not match this API key',
        403,
      )
    }
    if (global && !hasScope(ctx.scopes, 'postbus:send')) {
      return fail(
        'forbidden',
        'Global PostBus sending requires the postbus:send scope',
        403,
      )
    }
    if (!global && row.postbus_merchant_id !== merchantId) {
      return fail(
        'invalid_merchant_mapping',
        'merchant_id does not match this API key',
        403,
      )
    }

    const settings = parseNotificationSettings(row.notification_settings)
    if (!settings[notificationType]) {
      return fail(
        'notification_disabled',
        global
          ? `${notificationType} notifications are disabled for this global sender`
          : `${notificationType} notifications are disabled`,
        400,
      )
    }

    const whatsappOk = await accountHasWhatsAppConfig(ctx.supabase, ctx.accountId)
    if (!whatsappOk) {
      return fail(
        'whatsapp_not_configured',
        'WhatsApp is not configured for this account',
        400,
      )
    }

    const templateName = templateNameForEvent(row, notificationType)
    if (!templateName) {
      return fail(
        'template_missing',
        `No template mapped for ${notificationType}`,
        400,
      )
    }

    const language = row.template_language?.trim() || 'en_US'
    const { data: templateRow, error: tplErr } = await ctx.supabase
      .from('message_templates')
      .select('name, language, body_text, status')
      .eq('account_id', ctx.accountId)
      .eq('name', templateName)
      .maybeSingle()

    if (tplErr) {
      console.error('[postbus/notifications] template lookup:', tplErr)
      return fail('internal', 'Failed to load template', 500)
    }
    if (!templateRow?.body_text) {
      return fail(
        'template_malformed',
        'Mapped template has no body text',
        400,
      )
    }

    const params = postbusTemplateBodyParams(templateRow.body_text as string, {
      customer_name: str(body, 'customer_name'),
      shop_name: str(body, 'shop_name'),
      order_number: str(body, 'order_number'),
      tracking_number: str(body, 'tracking_number'),
      tracking_url: str(body, 'tracking_url'),
    })

    const resolved = await resolveConversationByPhone(
      ctx.supabase,
      ctx.accountId,
      to,
      str(body, 'customer_name') || null,
    )

    const sent = await sendMessageToConversation(ctx.supabase, ctx.accountId, {
      conversationId: resolved.conversationId,
      messageType: 'template',
      templateName,
      templateLanguage: (templateRow.language as string) || language,
      templateParams: params,
    })

    const { data: inserted, error: insertErr } = await ctx.supabase
      .from('postbus_notifications')
      .insert({
        account_id: ctx.accountId,
        merchant_id: merchantId,
        external_ref: externalRef,
        notification_type: notificationType,
        to_phone: sanitizePhoneForMeta(to),
        contact_id: resolved.contactId,
        conversation_id: resolved.conversationId,
        message_id: sent.messageId,
        whatsapp_message_id: sent.whatsappMessageId,
        status: 'sent',
      })
      .select('id')
      .single()

    if (insertErr) {
      if (isUniqueViolation(insertErr)) {
        const { data: raced } = await ctx.supabase
          .from('postbus_notifications')
          .select(
            'message_id, whatsapp_message_id, conversation_id, contact_id, status',
          )
          .eq('account_id', ctx.accountId)
          .eq('external_ref', externalRef)
          .maybeSingle()
        if (raced) {
          return ok({
            duplicate: true,
            message_id: raced.message_id,
            whatsapp_message_id: raced.whatsapp_message_id,
            conversation_id: raced.conversation_id,
            contact_id: raced.contact_id,
            status: raced.status,
          })
        }
        return fail('duplicate', 'Notification already processed', 409)
      }
      console.error('[postbus/notifications] insert:', insertErr)
      return fail('internal', 'Failed to record notification', 500)
    }

    void inserted
    return ok(
      {
        message_id: sent.messageId,
        whatsapp_message_id: sent.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
        duplicate: false,
      },
      201,
    )
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status)
    }
    return toApiErrorResponse(err)
  }
}
