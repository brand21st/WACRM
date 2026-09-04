import { describe, expect, it, vi } from 'vitest'
import { addressFingerprint, touchSavedAddress } from './saved-addresses'

const home = {
  name: 'Goutham',
  address_line1: 'Wayanad house, Sulthan Bathery',
  city: 'Wayanad',
  state: 'Kerala',
  country: 'India',
  postal_code: '673592',
}

describe('addressFingerprint', () => {
  it('is stable across casing and punctuation so the picker does not stack duplicates', () => {
    const a = addressFingerprint(home)
    const b = addressFingerprint({
      ...home,
      name: 'GOUTHAM',
      address_line1: 'Wayanad house, Sulthan Bathery.',
    })
    expect(a).toBe(b)
    expect(a.length).toBeGreaterThan(10)
  })

  it('treats a different PIN as a different address', () => {
    expect(addressFingerprint(home)).not.toBe(
      addressFingerprint({ ...home, postal_code: '560001' }),
    )
  })
})

describe('touchSavedAddress', () => {
  it('ignores ids that are not UUIDs so a Meta round-trip cannot hit Postgres', async () => {
    const update = vi.fn()
    await touchSavedAddress({
      db: { from: () => ({ update }) } as never,
      accountId: 'acct',
      savedAddressId: 'not-a-uuid',
    })
    expect(update).not.toHaveBeenCalled()
  })
})
