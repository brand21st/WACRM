import { describe, expect, it } from 'vitest'

import { assertPageMessagingWindow } from '@/lib/meta/page-send'
import { SendMessageError } from '@/lib/whatsapp/send-message'

describe('assertPageMessagingWindow', () => {
  it('rejects a missing window', () => {
    expect(() => assertPageMessagingWindow(null)).toThrow(SendMessageError)
    try {
      assertPageMessagingWindow(undefined)
    } catch (err) {
      expect(err).toBeInstanceOf(SendMessageError)
      expect((err as SendMessageError).status).toBe(400)
      expect((err as SendMessageError).code).toBe('session_expired')
    }
  })

  it('rejects an expired window', () => {
    const expired = new Date(Date.now() - 60_000).toISOString()
    expect(() => assertPageMessagingWindow(expired)).toThrow(SendMessageError)
  })

  it('allows a live 24h window', () => {
    const live = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
    expect(() => assertPageMessagingWindow(live)).not.toThrow()
  })
})
