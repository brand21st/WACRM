import { describe, expect, it, vi } from 'vitest'

import {
  persistProfileWhatsApp,
  whatsappDigitsFromMetadata,
} from './persist-whatsapp'

describe('whatsappDigitsFromMetadata', () => {
  it('keeps digits-only Meta form', () => {
    expect(whatsappDigitsFromMetadata('919876543210')).toBe('919876543210')
  })

  it('strips formatting', () => {
    expect(whatsappDigitsFromMetadata('+91 98765 43210')).toBe('919876543210')
  })

  it('rejects empty and non-strings', () => {
    expect(whatsappDigitsFromMetadata('')).toBeNull()
    expect(whatsappDigitsFromMetadata(null)).toBeNull()
    expect(whatsappDigitsFromMetadata({ n: '91' })).toBeNull()
  })
})

describe('persistProfileWhatsApp', () => {
  it('does not touch the database when metadata is empty', async () => {
    const from = vi.fn()
    await persistProfileWhatsApp(
      { from } as never,
      'user-1',
      undefined,
    )
    expect(from).not.toHaveBeenCalled()
  })

  it('writes digits onto the caller profile when empty', async () => {
    const is = vi.fn().mockResolvedValue({ error: null })
    const eq = vi.fn(() => ({ is }))
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))

    await persistProfileWhatsApp(
      { from } as never,
      'user-1',
      '+91 98765 43210',
    )

    expect(from).toHaveBeenCalledWith('profiles')
    expect(update).toHaveBeenCalledWith({ whatsapp_number: '919876543210' })
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(is).toHaveBeenCalledWith('whatsapp_number', null)
  })

  it('overwrites when onlyIfEmpty is false', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ update }))

    await persistProfileWhatsApp(
      { from } as never,
      'user-1',
      '919876543210',
      { onlyIfEmpty: false },
    )

    expect(eq).toHaveBeenCalledTimes(1)
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })
})
