import { describe, expect, it } from 'vitest'

import {
  packInstalledShopifyCredential,
  packShopifyCredential,
  packShopifyCredentialForPersist,
  resolveStoredClientId,
  unpackShopifyCredential,
} from './credential-storage'

describe('credential-storage', () => {
  it('packs shpss secret with client id into JSON blob', () => {
    const packed = packShopifyCredential(
      '914e6a78819a67dde293e4d5893867d6',
      'shpss_test_secret',
    )
    expect(packed.startsWith('{')).toBe(true)
    const unpacked = unpackShopifyCredential(packed)
    expect(unpacked.credential).toBe('shpss_test_secret')
    expect(unpacked.clientId).toBe('914e6a78819a67dde293e4d5893867d6')
    expect(unpacked.webhookSecret).toBe('shpss_test_secret')
  })

  it('keeps shpat tokens as plain text', () => {
    const token = 'shpat_admin_token_value'
    expect(packShopifyCredential('client-id', token)).toBe(token)
    expect(unpackShopifyCredential(token)).toEqual({
      credential: token,
      clientId: null,
      webhookSecret: null,
    })
  })

  it('packs installed OAuth tokens with webhook secret', () => {
    const packed = packInstalledShopifyCredential({
      clientId: '914e6a78819a67dde293e4d5893867d6',
      accessToken: 'shpat_from_oauth',
      webhookSecret: 'shpss_partner_secret',
    })
    const unpacked = unpackShopifyCredential(packed)
    expect(unpacked.credential).toBe('shpat_from_oauth')
    expect(unpacked.clientId).toBe('914e6a78819a67dde293e4d5893867d6')
    expect(unpacked.webhookSecret).toBe('shpss_partner_secret')
  })

  it('prefers row client_id over packed value', () => {
    expect(
      resolveStoredClientId('from-row', 'from-blob'),
    ).toBe('from-row')
    expect(resolveStoredClientId(null, 'from-blob')).toBe('from-blob')
  })

  it('keeps the webhook secret when persisting an unchanged shpat after OAuth', () => {
    const packed = packShopifyCredentialForPersist({
      clientId: '914e6a78819a67dde293e4d5893867d6',
      credential: 'shpat_from_oauth',
      existingWebhookSecret: 'shpss_partner_secret',
    })
    expect(unpackShopifyCredential(packed)).toEqual({
      credential: 'shpat_from_oauth',
      clientId: '914e6a78819a67dde293e4d5893867d6',
      webhookSecret: 'shpss_partner_secret',
    })
  })

  it('attaches a new api secret onto a custom shpat token', () => {
    const packed = packShopifyCredentialForPersist({
      clientId: '914e6a78819a67dde293e4d5893867d6',
      credential: 'shpat_custom_token',
      incomingWebhookSecret: 'shpss_new_secret',
    })
    expect(unpackShopifyCredential(packed).webhookSecret).toBe('shpss_new_secret')
    expect(unpackShopifyCredential(packed).credential).toBe('shpat_custom_token')
  })

  it('lets an incoming api secret replace the stored one', () => {
    const packed = packShopifyCredentialForPersist({
      clientId: 'cid',
      credential: 'shpat_from_oauth',
      existingWebhookSecret: 'shpss_old',
      incomingWebhookSecret: 'shpss_new',
    })
    expect(unpackShopifyCredential(packed).webhookSecret).toBe('shpss_new')
  })

  it('leaves a shpat-only custom app without a webhook secret', () => {
    expect(
      packShopifyCredentialForPersist({
        credential: 'shpat_custom_token',
      }),
    ).toBe('shpat_custom_token')
  })
})
