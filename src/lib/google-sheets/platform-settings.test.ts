import { describe, expect, it } from 'vitest'

import { isGoogleClientId } from './platform-settings'

describe('isGoogleClientId', () => {
  it('accepts Google Cloud web client IDs', () => {
    expect(
      isGoogleClientId('123456789012-abcdef.apps.googleusercontent.com'),
    ).toBe(true)
  })

  it('rejects empty or non-Google IDs', () => {
    expect(isGoogleClientId('')).toBe(false)
    expect(isGoogleClientId('rzp_live_xxx')).toBe(false)
    expect(isGoogleClientId('apps.googleusercontent.com')).toBe(false)
  })
})
