import { describe, expect, it } from 'vitest'
import { parseWhatsAppPaymentLookup } from './meta-api'

describe('parseWhatsAppPaymentLookup', () => {
  it('reads the documented payments array', () => {
    const parsed = parseWhatsAppPaymentLookup(
      {
        payments: [
          {
            reference_id: 'wac_1',
            status: 'captured',
            transactions: [{ status: 'success' }],
          },
        ],
      },
      'wac_1',
    )
    expect(parsed?.status).toBe('captured')
    expect(parsed?.transactions[0]?.status).toBe('success')
  })

  it('reads a top-level payment object', () => {
    const parsed = parseWhatsAppPaymentLookup(
      {
        reference_id: 'wac_1',
        status: 'pending',
        transactions: [{ status: 'success' }],
      },
      'wac_1',
    )
    expect(parsed?.status).toBe('captured')
  })

  it('reads a Graph data array', () => {
    const parsed = parseWhatsAppPaymentLookup(
      {
        data: [{ reference_id: 'wac_1', status: 'captured', transactions: [] }],
      },
      'wac_fallback',
    )
    expect(parsed?.reference_id).toBe('wac_1')
    expect(parsed?.status).toBe('captured')
  })

  it('returns null when there is no payment object', () => {
    expect(parseWhatsAppPaymentLookup({ payments: [] }, 'wac_1')).toBeNull()
    expect(parseWhatsAppPaymentLookup({}, 'wac_1')).toBeNull()
  })
})
