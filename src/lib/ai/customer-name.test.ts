import { describe, it, expect } from 'vitest'
import { speakableFirstName } from './customer-name'

describe('speakableFirstName', () => {
  it('takes the first token from a full name', () => {
    expect(speakableFirstName('Anil Kumar')).toBe('Anil')
    expect(speakableFirstName('  Priya  ')).toBe('Priya')
  })

  it('title-cases an ALL-CAPS Latin first name', () => {
    expect(speakableFirstName('ANIL KUMAR')).toBe('Anil')
  })

  it('drops empties, single letters, and phone-like values', () => {
    expect(speakableFirstName(null)).toBeNull()
    expect(speakableFirstName('')).toBeNull()
    expect(speakableFirstName('A')).toBeNull()
    expect(speakableFirstName('+919876543210')).toBeNull()
    expect(speakableFirstName('15551212')).toBeNull()
  })
})
