import type { IntegrationStatus } from '@/lib/integrations/types'

import type { PostBusNotificationEvent } from './events'

export type PostBusConnectionStatus = IntegrationStatus

export type PostBusNotificationSettings = Record<
  PostBusNotificationEvent,
  boolean
>

export interface PostBusMerchantMapping {
  postbusMerchantId: string | null
  vachatAccountId: string
}

export interface PostBusTemplateMap {
  order_confirmation_template_name: string | null
  processing_template_name: string | null
  booked_template_name: string | null
  in_transit_template_name: string | null
  delivered_template_name: string | null
  template_language: string
}

export interface PostBusIntegrationConfig {
  id: string | null
  accountId: string
  postbusMerchantId: string | null
  apiBaseUrl: string | null
  hasApiKey: boolean
  status: PostBusConnectionStatus
  notificationSettings: PostBusNotificationSettings
  connectedAt: string | null
  lastTestedAt: string | null
  lastTestResult: PostBusTestResultCode | null
}

export const POSTBUS_TEST_RESULT_CODES = [
  'connection_successful',
  'authentication_failed',
  'configuration_missing',
  'invalid_account',
  'whatsapp_not_configured',
  'api_error',
  'connection_error',
  'not_configured',
  'error',
] as const

export type PostBusTestResultCode = (typeof POSTBUS_TEST_RESULT_CODES)[number]
