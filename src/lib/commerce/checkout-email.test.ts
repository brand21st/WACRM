import { describe, expect, it } from 'vitest'
import {
  emailSkipReplyId,
  isEmailSkipText,
  parseEmailSkipReply,
  parseOptionalEmail,
} from './checkout-email'

describe('parseOptionalEmail', () => {
  it('accepts a normal email', () => {
    expect(parseOptionalEmail('Ada@Example.com')).toBe('ada@example.com')
  })

  it('rejects non-emails', () => {
    expect(parseOptionalEmail('SAVE10')).toBeNull()
    expect(parseOptionalEmail('not an email')).toBeNull()
    expect(parseOptionalEmail('')).toBeNull()
  })
})

describe('email skip', () => {
  it('round-trips the skip button', () => {
    expect(parseEmailSkipReply(emailSkipReplyId('wac_mtlsry8674y48w'))).toEqual({
      referenceId: 'wac_mtlsry8674y48w',
    })
    expect(parseEmailSkipReply('wac_disc_skip:wac_mtlsry8674y48w')).toBeNull()
  })

  it('treats typed skip words as skip', () => {
    expect(isEmailSkipText('Skip')).toBe(true)
    expect(isEmailSkipText('ada@example.com')).toBe(false)
  })
})
