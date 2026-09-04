import { describe, expect, it } from 'vitest'
import {
  formatPlanDate,
  isAccountStatus,
  normalizeAccountStatus,
} from './account-status'

describe('isAccountStatus', () => {
  it('accepts Active, Hold, and Block (suspended)', () => {
    expect(isAccountStatus('active')).toBe(true)
    expect(isAccountStatus('hold')).toBe(true)
    expect(isAccountStatus('suspended')).toBe(true)
  })

  it('rejects unknown values used as list filters', () => {
    expect(isAccountStatus('all')).toBe(false)
    expect(isAccountStatus('block')).toBe(false)
    expect(isAccountStatus('')).toBe(false)
    expect(isAccountStatus(null)).toBe(false)
  })
})

describe('normalizeAccountStatus', () => {
  it('falls back to active', () => {
    expect(normalizeAccountStatus('hold')).toBe('hold')
    expect(normalizeAccountStatus('nope')).toBe('active')
  })
})

describe('formatPlanDate', () => {
  it('renders a locale date and dashes missing values', () => {
    expect(formatPlanDate(null)).toBe('—')
    expect(formatPlanDate('not-a-date')).toBe('—')
    expect(formatPlanDate('2026-09-05T00:00:00.000Z')).not.toBe('—')
  })
})
