import { describe, expect, it, vi } from 'vitest'
import {
  clampNationalDigits,
  composeWhatsAppNumber,
  DEFAULT_COUNTRY_ISO2,
  flagEmoji,
  flagImageUrl,
  formatWhatsAppDisplay,
  splitWhatsAppNumber,
} from './dial-codes'
import {
  clientIpFromHeaders,
  countryFromLocale,
  countryFromTimeZone,
  detectCountryFromBrowser,
  iso2FromGeoHeaders,
  isPublicIp,
  lookupCountryFromIp,
  normalizeGeoIso2,
} from './detect-country'

describe('dial codes', () => {
  it('defaults unknown splits to India', () => {
    expect(splitWhatsAppNumber('').iso2).toBe(DEFAULT_COUNTRY_ISO2)
  })

  it('splits an Indian E.164 number', () => {
    expect(splitWhatsAppNumber('+91 98765 43210')).toEqual({
      iso2: 'IN',
      national: '9876543210',
    })
  })

  it('formats a stored number for profile chrome', () => {
    expect(formatWhatsAppDisplay('919876543210')).toBe('+91 9876543210')
    expect(formatWhatsAppDisplay(null)).toBe('')
  })

  it('composes a valid Indian mobile', () => {
    expect(composeWhatsAppNumber('IN', '098765 43210')).toBe('919876543210')
    expect(composeWhatsAppNumber('IN', '9876543210')).toBe('919876543210')
  })

  it('does not double the country code when it is pasted into the local field', () => {
    expect(composeWhatsAppNumber('IN', '919876543210')).toBe('919876543210')
  })

  it('rejects a short local number', () => {
    expect(composeWhatsAppNumber('IN', '12')).toBeNull()
    expect(composeWhatsAppNumber('IN', '987654321')).toBeNull()
  })

  it('rejects a local number longer than the country allows', () => {
    expect(composeWhatsAppNumber('IN', '98765432109')).toBeNull()
  })

  it('clamps typed digits to the country max', () => {
    expect(clampNationalDigits('IN', '98765432109')).toBe('9876543210')
    expect(clampNationalDigits('SG', '123456789')).toBe('12345678')
  })

  it('accepts country-correct lengths', () => {
    expect(composeWhatsAppNumber('US', '4155551212')).toBe('14155551212')
    expect(composeWhatsAppNumber('SG', '81234567')).toBe('6581234567')
  })

  it('builds a flag emoji from ISO2', () => {
    expect(flagEmoji('IN')).toBe('🇮🇳')
  })

  it('builds a flag image URL from ISO2', () => {
    expect(flagImageUrl('IN')).toBe('https://flagcdn.com/w40/in.png')
  })
})

describe('detectCountryFromBrowser', () => {
  it('maps Asia/Kolkata to India', () => {
    expect(countryFromTimeZone('Asia/Kolkata')).toBe('IN')
    expect(
      detectCountryFromBrowser({ timeZone: 'Asia/Kolkata', languages: [] }),
    ).toBe('IN')
  })

  it('uses locale region when timezone is unknown', () => {
    expect(countryFromLocale('en-AE')).toBe('AE')
    expect(
      detectCountryFromBrowser({
        timeZone: 'Etc/UTC',
        languages: ['en-AE'],
      }),
    ).toBe('AE')
  })

  it('falls back to India', () => {
    expect(
      detectCountryFromBrowser({ timeZone: 'Etc/UTC', languages: [] }),
    ).toBe('IN')
  })
})

describe('geo headers and IP', () => {
  it('reads Cloudflare country and ignores XX', () => {
    expect(
      iso2FromGeoHeaders((name) =>
        name === 'cf-ipcountry' ? 'in' : null,
      ),
    ).toBe('IN')
    expect(
      iso2FromGeoHeaders((name) =>
        name === 'cf-ipcountry' ? 'XX' : null,
      ),
    ).toBeNull()
    expect(normalizeGeoIso2('T1')).toBeNull()
  })

  it('picks a public IP from x-forwarded-for', () => {
    expect(isPublicIp('127.0.0.1')).toBe(false)
    expect(isPublicIp('10.0.0.8')).toBe(false)
    expect(isPublicIp('172.16.1.1')).toBe(false)
    expect(isPublicIp('8.8.8.8')).toBe(true)
    expect(
      clientIpFromHeaders((name) =>
        name === 'x-forwarded-for' ? '10.0.0.1, 1.2.3.4' : null,
      ),
    ).toBe('1.2.3.4')
  })

  it('looks up a public IP country', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ country: 'IN' }),
    })
    await expect(lookupCountryFromIp('1.2.3.4', fetchImpl)).resolves.toBe('IN')
    expect(fetchImpl).toHaveBeenCalled()
  })

  it('skips lookup for private IPs', async () => {
    const fetchImpl = vi.fn()
    await expect(lookupCountryFromIp('192.168.0.10', fetchImpl)).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
