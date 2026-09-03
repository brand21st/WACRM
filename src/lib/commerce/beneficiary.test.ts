import { describe, expect, it } from 'vitest'
import { canonicalIndianState, parseBeneficiaryFromText } from './beneficiary'

describe('parseBeneficiaryFromText', () => {
  it('reads an address typed one value per line, with no field labels', () => {
    // The exact message that used to loop the address prompt forever:
    // city and state were only ever read from `City:` / `State:` labels.
    const beneficiary = parseBeneficiaryFromText(
      'Goutham  \nWayanad house\nSulthan Bathery  \nWayanad  \nKerala\n673592',
      'Goutham S',
    )
    expect(beneficiary).toEqual({
      name: 'Goutham',
      address_line1: 'Wayanad house, Sulthan Bathery',
      address_line2: undefined,
      city: 'Wayanad',
      state: 'Kerala',
      country: 'India',
      postal_code: '673592',
    })
  })

  it('still prefers explicit labels', () => {
    const beneficiary = parseBeneficiaryFromText(
      'Name: Ada Lovelace\nAddress: 12 MG Road\nCity: Bengaluru\nState: Karnataka\nPIN: 560001',
    )
    expect(beneficiary).toMatchObject({
      name: 'Ada Lovelace',
      address_line1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      postal_code: '560001',
    })
  })

  it('splits a single comma-separated line', () => {
    const beneficiary = parseBeneficiaryFromText(
      'Goutham, Wayanad house, Sulthan Bathery, Wayanad, Kerala, 673592',
    )
    expect(beneficiary).toMatchObject({
      name: 'Goutham',
      address_line1: 'Wayanad house, Sulthan Bathery',
      city: 'Wayanad',
      state: 'Kerala',
      postal_code: '673592',
    })
  })

  it('falls back to the contact name when the address has no name line', () => {
    const beneficiary = parseBeneficiaryFromText(
      '12 MG Road\nBengaluru\nKarnataka\n560001',
      'Ada Lovelace',
    )
    expect(beneficiary).toMatchObject({
      name: 'Ada Lovelace',
      address_line1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
    })
  })

  it('accepts an unrecognised state spelling by position', () => {
    const beneficiary = parseBeneficiaryFromText(
      '12 Main Road\nSomeTown\nSomeProvince\n560001',
      'Ada',
    )
    expect(beneficiary).toMatchObject({
      city: 'SomeTown',
      state: 'SomeProvince',
    })
  })

  it('returns null when the message is not an address', () => {
    expect(parseBeneficiaryFromText('ok thanks', 'Ada')).toBeNull()
    expect(parseBeneficiaryFromText('', 'Ada')).toBeNull()
    // A PIN alone is not enough to bill against.
    expect(parseBeneficiaryFromText('673592', 'Ada')).toBeNull()
  })
})

describe('canonicalIndianState', () => {
  it('normalises spelling and common alternate names', () => {
    expect(canonicalIndianState('kerala')).toBe('Kerala')
    expect(canonicalIndianState('  TAMIL NADU ')).toBe('Tamil Nadu')
    expect(canonicalIndianState('Orissa')).toBe('Odisha')
    expect(canonicalIndianState('New Delhi')).toBe('Delhi')
    expect(canonicalIndianState('Wayanad')).toBeNull()
  })
})
