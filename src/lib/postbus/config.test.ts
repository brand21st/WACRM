import { describe, expect, it } from 'vitest'

import {
  derivePostBusStatus,
  parseNotificationSettings,
  toPublicConfig,
  type PostBusIntegrationRow,
} from './config'

describe('derivePostBusStatus', () => {
  it('is connected when merchant ID and WhatsApp config exist', () => {
    expect(
      derivePostBusStatus({
        postbusMerchantId: 'm-1',
        whatsappConfigured: true,
      }),
    ).toBe('connected')
  })

  it('does not require a PostBus URL or API key', () => {
    expect(
      derivePostBusStatus({
        postbusMerchantId: 'm-1',
        whatsappConfigured: true,
      }),
    ).toBe('connected')
  })

  it('is connected in global mode without a merchant ID', () => {
    expect(
      derivePostBusStatus({
        postbusMerchantId: '',
        whatsappConfigured: true,
        routingMode: 'global',
      }),
    ).toBe('connected')
  })

  it('returns configuration_required without merchant or WhatsApp', () => {
    expect(
      derivePostBusStatus({
        postbusMerchantId: '',
        whatsappConfigured: true,
      }),
    ).toBe('configuration_required')
    expect(
      derivePostBusStatus({
        postbusMerchantId: 'm-1',
        whatsappConfigured: false,
      }),
    ).toBe('configuration_required')
  })
})

describe('toPublicConfig', () => {
  const row: PostBusIntegrationRow = {
    id: 'row-1',
    account_id: 'acct-1',
    postbus_merchant_id: 'merchant-9',
    api_base_url: 'https://api.example.com',
    api_key_encrypted: 'enc_secret_must_not_leak',
    status: 'connected',
    notification_settings: { booked: true },
    connected_at: '2026-01-01T00:00:00.000Z',
    last_tested_at: null,
    last_test_result: null,
  }

  it('never includes the encrypted API key', () => {
    const publicRow = toPublicConfig(row, { whatsappConfigured: true })
    const serialized = JSON.stringify(publicRow)
    expect(publicRow.has_api_key).toBe(true)
    expect(serialized).not.toContain('enc_secret_must_not_leak')
    expect(publicRow).not.toHaveProperty('api_key_encrypted')
    expect(publicRow).not.toHaveProperty('api_key')
  })

  it('parses live notification events', () => {
    const settings = parseNotificationSettings({ booked: true, order_created: true })
    expect(settings.booked).toBe(true)
    expect(settings.delivered).toBe(false)
    expect(settings).not.toHaveProperty('order_created')
  })
})
