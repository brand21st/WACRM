import { describe, expect, it } from 'vitest'
import {
  addressFormValuesFromBeneficiary,
  parseAddressMessageReply,
} from './address-form'
import { sendAddressMessage } from '@/lib/whatsapp/meta-api'

describe('parseAddressMessageReply', () => {
  it('collapses the street fields into address_line1', () => {
    const submission = parseAddressMessageReply(
      JSON.stringify({
        name: 'Ada Lovelace',
        house_number: '12',
        building_name: 'Analytical Apartments',
        address: 'MG Road',
        landmark_area: 'Near Trinity Metro',
        city: 'Bengaluru',
        state: 'Karnataka',
        in_pin_code: '560001',
      }),
    )!
    expect(submission.validationErrors).toEqual({})
    expect(submission.beneficiary).toEqual({
      name: 'Ada Lovelace',
      address_line1: '12, Analytical Apartments, MG Road',
      address_line2: 'Near Trinity Metro',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      postal_code: '560001',
    })
  })

  it('reports per-field errors and keeps the answer for the re-ask', () => {
    const submission = parseAddressMessageReply({
      name: 'Ada Lovelace',
      address: 'MG Road',
      city: 'Bengaluru',
      in_pin_code: '56000',
    })!
    expect(submission.beneficiary).toBeNull()
    expect(submission.validationErrors.state).toBeTruthy()
    expect(submission.validationErrors.in_pin_code).toBeTruthy()
    expect(submission.validationErrors.name).toBeUndefined()
    expect(submission.values.address).toBe('MG Road')
  })

  it('returns null for a non-object payload', () => {
    expect(parseAddressMessageReply('not json')).toBeNull()
    expect(parseAddressMessageReply(undefined)).toBeNull()
  })
})

describe('addressFormValuesFromBeneficiary', () => {
  it('prefills the form from a known address', () => {
    const values = addressFormValuesFromBeneficiary(
      {
        name: 'Ada Lovelace',
        address_line1: '12 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        postal_code: '560001',
      },
      '+919876543210',
    )
    expect(values).toEqual({
      phone_number: '+919876543210',
      name: 'Ada Lovelace',
      address: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      in_pin_code: '560001',
    })
  })
})

describe('sendAddressMessage', () => {
  it('sends an India address form and drops empty prefill fields', async () => {
    let captured: Record<string, unknown> | null = null
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof globalThis.fetch

    try {
      const result = await sendAddressMessage({
        phoneNumberId: '123',
        accessToken: 'token',
        to: '+919876543210',
        bodyText: 'Where should we deliver?',
        values: { name: 'Ada', city: '   ' },
        validationErrors: { in_pin_code: 'Enter a valid 6-digit PIN code.' },
      })
      expect(result.messageId).toBe('wamid.1')
    } finally {
      globalThis.fetch = originalFetch
    }

    const interactive = (captured as unknown as {
      interactive: {
        type: string
        action: { name: string; parameters: Record<string, unknown> }
      }
    }).interactive
    expect(interactive.type).toBe('address_message')
    expect(interactive.action.name).toBe('address_message')
    expect(interactive.action.parameters.country).toBe('IN')
    expect(interactive.action.parameters.values).toEqual({ name: 'Ada' })
    expect(interactive.action.parameters.validation_errors).toEqual({
      in_pin_code: 'Enter a valid 6-digit PIN code.',
    })
  })
})
