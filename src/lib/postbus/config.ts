import type { IntegrationConnection, IntegrationStatus } from '@/lib/integrations/types'

import {
  POSTBUS_NOTIFICATION_EVENTS,
  POSTBUS_TEMPLATE_COLUMNS,
  type PostBusNotificationEvent,
} from './events'
import type {
  PostBusNotificationSettings,
  PostBusTestResultCode,
} from './types'
import { POSTBUS_TEST_RESULT_CODES } from './types'

export const POSTBUS_CONFIG_COLUMNS =
  'id, account_id, postbus_merchant_id, routing_mode, api_base_url, api_key_encrypted, status, notification_settings, connected_at, last_tested_at, last_test_result, order_confirmation_template_name, processing_template_name, booked_template_name, in_transit_template_name, delivered_template_name, template_language, webhook_endpoint_id'

export type PostBusRoutingMode = 'merchant' | 'global'

export function parsePostBusRoutingMode(raw: unknown): PostBusRoutingMode {
  return raw === 'global' ? 'global' : 'merchant'
}

export function isGlobalPostBusMode(
  row: { routing_mode?: string | null } | null | undefined,
): boolean {
  return parsePostBusRoutingMode(row?.routing_mode) === 'global'
}

export const MASKED_POSTBUS_API_KEY = '••••••••••••••••'

export interface PostBusIntegrationRow {
  id: string
  account_id: string
  postbus_merchant_id: string | null
  routing_mode?: string | null
  api_base_url: string | null
  api_key_encrypted: string | null
  status: string
  notification_settings: unknown
  connected_at: string | null
  last_tested_at: string | null
  last_test_result: string | null
  order_confirmation_template_name?: string | null
  processing_template_name?: string | null
  booked_template_name?: string | null
  in_transit_template_name?: string | null
  delivered_template_name?: string | null
  template_language?: string | null
  webhook_endpoint_id?: string | null
}

export function defaultNotificationSettings(): PostBusNotificationSettings {
  return Object.fromEntries(
    POSTBUS_NOTIFICATION_EVENTS.map((event) => [event, false]),
  ) as PostBusNotificationSettings
}

export function parseNotificationSettings(
  raw: unknown,
): PostBusNotificationSettings {
  const defaults = defaultNotificationSettings()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
  const o = raw as Record<string, unknown>
  for (const event of POSTBUS_NOTIFICATION_EVENTS) {
    if (typeof o[event] === 'boolean') defaults[event] = o[event]
  }
  return defaults
}

export function isMaskedApiKey(value: string): boolean {
  return value.length > 0 && /^•+$/.test(value.trim())
}

export function derivePostBusStatus(args: {
  postbusMerchantId: string | null | undefined
  whatsappConfigured: boolean
  routingMode?: PostBusRoutingMode | string | null
}): Exclude<IntegrationStatus, 'needs_reconnect'> {
  if (!args.whatsappConfigured) return 'configuration_required'
  if (parsePostBusRoutingMode(args.routingMode) === 'global') return 'connected'
  const merchant = args.postbusMerchantId?.trim() ?? ''
  if (!merchant) return 'configuration_required'
  return 'connected'
}

export function parseTestResultCode(
  raw: string | null | undefined,
): PostBusTestResultCode | null {
  if (!raw) return null
  return (POSTBUS_TEST_RESULT_CODES as readonly string[]).includes(raw)
    ? (raw as PostBusTestResultCode)
    : null
}

export interface PostBusApprovedTemplate {
  name: string
  language: string
  status: string
}

export interface PostBusPublicConfig extends IntegrationConnection {
  has_api_key: boolean
  id: string | null
  account_id: string
  postbus_merchant_id: string | null
  routing_mode: PostBusRoutingMode
  api_base_url: string | null
  connected_at: string | null
  last_tested_at: string | null
  last_test_result: PostBusTestResultCode | null
  notification_settings: PostBusNotificationSettings
  template_language: string
  order_confirmation_template_name: string | null
  processing_template_name: string | null
  booked_template_name: string | null
  in_transit_template_name: string | null
  delivered_template_name: string | null
  webhook_endpoint_id: string | null
  status_webhook_url: string | null
  whatsapp_connected: boolean
  has_send_api_key: boolean
  enabled_notification_count: number
  approved_templates: PostBusApprovedTemplate[]
}

export function emptyPublicConfig(accountId: string): PostBusPublicConfig {
  return {
    connected: false,
    status: 'not_connected',
    accountLabel: null,
    detailLabel: null,
    lastSyncedAt: null,
    has_api_key: false,
    id: null,
    account_id: accountId,
    postbus_merchant_id: null,
    routing_mode: 'merchant',
    api_base_url: null,
    connected_at: null,
    last_tested_at: null,
    last_test_result: null,
    notification_settings: defaultNotificationSettings(),
    template_language: 'en_US',
    order_confirmation_template_name: null,
    processing_template_name: null,
    booked_template_name: null,
    in_transit_template_name: null,
    delivered_template_name: null,
    webhook_endpoint_id: null,
    status_webhook_url: null,
    whatsapp_connected: false,
    has_send_api_key: false,
    enabled_notification_count: 0,
    approved_templates: [],
  }
}

export function enabledNotificationCount(
  settings: PostBusNotificationSettings,
): number {
  return POSTBUS_NOTIFICATION_EVENTS.filter((event) => settings[event]).length
}

export function toPublicConfig(
  row: PostBusIntegrationRow,
  opts?: {
    decryptFailed?: boolean
    whatsappConfigured?: boolean
    hasSendApiKey?: boolean
    approvedTemplates?: PostBusApprovedTemplate[]
    statusWebhookUrl?: string | null
  },
): PostBusPublicConfig {
  const hasApiKey = Boolean(row.api_key_encrypted)
  const settings = parseNotificationSettings(row.notification_settings)
  const whatsappConfigured = Boolean(opts?.whatsappConfigured)
  const routingMode = parsePostBusRoutingMode(row.routing_mode)
  const derived = opts?.decryptFailed
    ? 'error'
    : derivePostBusStatus({
        postbusMerchantId: row.postbus_merchant_id,
        whatsappConfigured,
        routingMode,
      })
  const enabled = enabledNotificationCount(settings)
  const waLabel = whatsappConfigured ? 'WhatsApp connected' : 'WhatsApp not connected'
  return {
    connected: derived === 'connected',
    status: derived,
    accountLabel: row.postbus_merchant_id,
    detailLabel: `${waLabel} · ${enabled} notifications enabled`,
    lastSyncedAt: row.last_tested_at,
    has_api_key: hasApiKey,
    id: row.id,
    account_id: row.account_id,
    postbus_merchant_id: row.postbus_merchant_id,
    routing_mode: routingMode,
    api_base_url: row.api_base_url,
    connected_at: row.connected_at,
    last_tested_at: row.last_tested_at,
    last_test_result: parseTestResultCode(row.last_test_result),
    notification_settings: settings,
    template_language: row.template_language?.trim() || 'en_US',
    order_confirmation_template_name: row.order_confirmation_template_name ?? null,
    processing_template_name: row.processing_template_name ?? null,
    booked_template_name: row.booked_template_name ?? null,
    in_transit_template_name: row.in_transit_template_name ?? null,
    delivered_template_name: row.delivered_template_name ?? null,
    webhook_endpoint_id: row.webhook_endpoint_id ?? null,
    status_webhook_url: opts?.statusWebhookUrl ?? null,
    whatsapp_connected: whatsappConfigured,
    has_send_api_key: Boolean(opts?.hasSendApiKey),
    enabled_notification_count: enabled,
    approved_templates: opts?.approvedTemplates ?? [],
  }
}

export function isPostBusNotificationEvent(
  value: string,
): value is PostBusNotificationEvent {
  return (POSTBUS_NOTIFICATION_EVENTS as readonly string[]).includes(value)
}

export function templateNameForEvent(
  row: PostBusIntegrationRow,
  event: PostBusNotificationEvent,
): string | null {
  const col = POSTBUS_TEMPLATE_COLUMNS[event]
  const name = row[col]
  return typeof name === 'string' && name.trim() ? name.trim() : null
}
