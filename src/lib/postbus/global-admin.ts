import type { SupabaseClient } from '@supabase/supabase-js'

import { ApiError } from '@/lib/api/v1/respond'
import {
  POSTBUS_CONFIG_COLUMNS,
  derivePostBusStatus,
  parseNotificationSettings,
  type PostBusIntegrationRow,
} from '@/lib/postbus/config'
import {
  POSTBUS_LIVE_EVENTS,
  POSTBUS_TEMPLATE_COLUMNS,
} from '@/lib/postbus/events'
import {
  accountHasWhatsAppConfig,
  listApprovedTemplates,
  officialWhatsAppIdentity,
} from '@/lib/postbus/readiness'

function postgrestString(err: unknown, key: 'code' | 'message'): string {
  if (!err || typeof err !== 'object' || !(key in err)) return ''
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

export function throwPostBusSaveError(error: unknown): never {
  const code = postgrestString(error, 'code')
  const message =
    postgrestString(error, 'message') || 'Failed to save global PostBus sender'
  if (code === '42703' && /routing_mode/i.test(message)) {
    throw new ApiError(
      'internal',
      'VaChat is missing postbus_integrations.routing_mode. Run migration 115_postbus_global_mode.sql on the VaChat database, then save templates again.',
      500,
    )
  }
  throw new ApiError('internal', message, 500)
}

export function templatesFromBody(
  body: Record<string, unknown>,
  existing?: PostBusIntegrationRow | null,
): Record<string, string | null> {
  const templates: Record<string, string | null> = {}
  for (const event of POSTBUS_LIVE_EVENTS) {
    const col = POSTBUS_TEMPLATE_COLUMNS[event]
    if (typeof body[col] === 'string') {
      templates[col] = body[col].trim() || null
    } else if (body[col] == null && col in body) {
      templates[col] = null
    } else {
      templates[col] = (existing?.[col] as string | null | undefined) ?? null
    }
  }
  return templates
}

export async function demoteOtherGlobalRows(
  admin: SupabaseClient,
  keepAccountId: string,
) {
  const { data: others } = await admin
    .from('postbus_integrations')
    .select(POSTBUS_CONFIG_COLUMNS)
    .eq('routing_mode', 'global')
    .neq('account_id', keepAccountId)

  for (const row of others ?? []) {
    const whatsappConfigured = await accountHasWhatsAppConfig(
      admin,
      row.account_id as string,
    )
    const status = derivePostBusStatus({
      postbusMerchantId: row.postbus_merchant_id as string | null,
      whatsappConfigured,
      routingMode: 'merchant',
    })
    await admin
      .from('postbus_integrations')
      .update({ routing_mode: 'merchant', status })
      .eq('id', row.id)
  }
}

export async function upsertGlobalPostBusAccount(
  admin: SupabaseClient,
  args: {
    accountId: string
    userId?: string | null
    body: Record<string, unknown>
  },
) {
  await demoteOtherGlobalRows(admin, args.accountId)

  const { data: existing } = await admin
    .from('postbus_integrations')
    .select(POSTBUS_CONFIG_COLUMNS)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const existingRow = existing as unknown as PostBusIntegrationRow | null
  const notificationSettings = parseNotificationSettings(
    'notification_settings' in args.body
      ? args.body.notification_settings
      : existingRow?.notification_settings,
  )
  const templates = templatesFromBody(args.body, existingRow)
  const whatsappConfigured = await accountHasWhatsAppConfig(admin, args.accountId)
  const status = derivePostBusStatus({
    postbusMerchantId: null,
    whatsappConfigured,
    routingMode: 'global',
  })
  const payload = {
    postbus_merchant_id: null,
    routing_mode: 'global' as const,
    status,
    notification_settings: notificationSettings,
    connected_at: existingRow?.connected_at ?? new Date().toISOString(),
    template_language:
      typeof args.body.template_language === 'string' &&
      args.body.template_language.trim()
        ? args.body.template_language.trim()
        : existingRow?.template_language || 'en_US',
    ...templates,
  }

  const query = existingRow
    ? admin
        .from('postbus_integrations')
        .update(payload)
        .eq('account_id', args.accountId)
        .select(POSTBUS_CONFIG_COLUMNS)
        .single()
    : admin
        .from('postbus_integrations')
        .insert({
          account_id: args.accountId,
          ...(args.userId ? { created_by: args.userId } : {}),
          ...payload,
        })
        .select(POSTBUS_CONFIG_COLUMNS)
        .single()

  const { data: saved, error } = await query
  if (error || !saved) {
    throwPostBusSaveError(error ?? new Error('Failed to save global PostBus sender'))
  }
  return saved as unknown as PostBusIntegrationRow
}

export async function globalPostBusPublicPayload(
  admin: SupabaseClient,
  row: PostBusIntegrationRow | null,
) {
  const accountId = row?.account_id ?? null
  const identity = accountId
    ? await officialWhatsAppIdentity(admin, accountId)
    : {
        account_id: null as string | null,
        display_phone: null as string | null,
        verified_name: null as string | null,
        connected: false,
      }
  const approved = accountId
    ? await listApprovedTemplates(admin, accountId)
    : []
  const settings = parseNotificationSettings(row?.notification_settings)
  return {
    account_id: accountId,
    routing_mode: row ? 'global' : 'merchant',
    notification_settings: settings,
    template_language: row?.template_language ?? 'en_US',
    order_confirmation_template_name: row?.order_confirmation_template_name ?? null,
    processing_template_name: row?.processing_template_name ?? null,
    booked_template_name: row?.booked_template_name ?? null,
    in_transit_template_name: row?.in_transit_template_name ?? null,
    delivered_template_name: row?.delivered_template_name ?? null,
    whatsapp_connected: identity.connected,
    display_phone_number: identity.display_phone,
    verified_name: identity.verified_name,
    approved_templates: approved,
  }
}
