import { parseWhatsAppNumber, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'

export const DEFAULT_COUNTRY_ISO2 = 'IN'

export type DialCountry = {
  iso2: string
  name: string
  dial: string
}

/** India first (primary market), then A–Z. Dial codes are digits only. */
export const DIAL_COUNTRIES: DialCountry[] = [
  { iso2: 'IN', name: 'India', dial: '91' },
  { iso2: 'AE', name: 'United Arab Emirates', dial: '971' },
  { iso2: 'AR', name: 'Argentina', dial: '54' },
  { iso2: 'AT', name: 'Austria', dial: '43' },
  { iso2: 'AU', name: 'Australia', dial: '61' },
  { iso2: 'BD', name: 'Bangladesh', dial: '880' },
  { iso2: 'BE', name: 'Belgium', dial: '32' },
  { iso2: 'BH', name: 'Bahrain', dial: '973' },
  { iso2: 'BR', name: 'Brazil', dial: '55' },
  { iso2: 'CA', name: 'Canada', dial: '1' },
  { iso2: 'CH', name: 'Switzerland', dial: '41' },
  { iso2: 'CN', name: 'China', dial: '86' },
  { iso2: 'DE', name: 'Germany', dial: '49' },
  { iso2: 'DK', name: 'Denmark', dial: '45' },
  { iso2: 'EG', name: 'Egypt', dial: '20' },
  { iso2: 'ES', name: 'Spain', dial: '34' },
  { iso2: 'FI', name: 'Finland', dial: '358' },
  { iso2: 'FR', name: 'France', dial: '33' },
  { iso2: 'GB', name: 'United Kingdom', dial: '44' },
  { iso2: 'GH', name: 'Ghana', dial: '233' },
  { iso2: 'HK', name: 'Hong Kong', dial: '852' },
  { iso2: 'ID', name: 'Indonesia', dial: '62' },
  { iso2: 'IE', name: 'Ireland', dial: '353' },
  { iso2: 'IL', name: 'Israel', dial: '972' },
  { iso2: 'IT', name: 'Italy', dial: '39' },
  { iso2: 'JP', name: 'Japan', dial: '81' },
  { iso2: 'KE', name: 'Kenya', dial: '254' },
  { iso2: 'KR', name: 'South Korea', dial: '82' },
  { iso2: 'KW', name: 'Kuwait', dial: '965' },
  { iso2: 'LK', name: 'Sri Lanka', dial: '94' },
  { iso2: 'MX', name: 'Mexico', dial: '52' },
  { iso2: 'MY', name: 'Malaysia', dial: '60' },
  { iso2: 'NG', name: 'Nigeria', dial: '234' },
  { iso2: 'NL', name: 'Netherlands', dial: '31' },
  { iso2: 'NO', name: 'Norway', dial: '47' },
  { iso2: 'NP', name: 'Nepal', dial: '977' },
  { iso2: 'NZ', name: 'New Zealand', dial: '64' },
  { iso2: 'OM', name: 'Oman', dial: '968' },
  { iso2: 'PH', name: 'Philippines', dial: '63' },
  { iso2: 'PK', name: 'Pakistan', dial: '92' },
  { iso2: 'PL', name: 'Poland', dial: '48' },
  { iso2: 'PT', name: 'Portugal', dial: '351' },
  { iso2: 'QA', name: 'Qatar', dial: '974' },
  { iso2: 'RO', name: 'Romania', dial: '40' },
  { iso2: 'RU', name: 'Russia', dial: '7' },
  { iso2: 'SA', name: 'Saudi Arabia', dial: '966' },
  { iso2: 'SE', name: 'Sweden', dial: '46' },
  { iso2: 'SG', name: 'Singapore', dial: '65' },
  { iso2: 'TH', name: 'Thailand', dial: '66' },
  { iso2: 'TR', name: 'Turkey', dial: '90' },
  { iso2: 'UA', name: 'Ukraine', dial: '380' },
  { iso2: 'US', name: 'United States', dial: '1' },
  { iso2: 'VN', name: 'Vietnam', dial: '84' },
  { iso2: 'ZA', name: 'South Africa', dial: '27' },
]

const BY_ISO2 = new Map(DIAL_COUNTRIES.map((c) => [c.iso2, c]))

const DIAL_PREFIXES = [...DIAL_COUNTRIES].sort(
  (a, b) => b.dial.length - a.dial.length || a.iso2.localeCompare(b.iso2),
)

/**
 * National (local) mobile length after the country code, no trunk 0.
 * India is always 10. Ranges follow typical WhatsApp/E.164 mobiles.
 */
const NSN_LENGTH: Record<string, { min: number; max: number }> = {
  IN: { min: 10, max: 10 },
  AE: { min: 9, max: 9 },
  AR: { min: 10, max: 10 },
  AT: { min: 10, max: 13 },
  AU: { min: 9, max: 9 },
  BD: { min: 10, max: 10 },
  BE: { min: 8, max: 9 },
  BH: { min: 8, max: 8 },
  BR: { min: 10, max: 11 },
  CA: { min: 10, max: 10 },
  CH: { min: 9, max: 9 },
  CN: { min: 11, max: 11 },
  DE: { min: 10, max: 11 },
  DK: { min: 8, max: 8 },
  EG: { min: 10, max: 10 },
  ES: { min: 9, max: 9 },
  FI: { min: 9, max: 10 },
  FR: { min: 9, max: 9 },
  GB: { min: 10, max: 10 },
  GH: { min: 9, max: 9 },
  HK: { min: 8, max: 8 },
  ID: { min: 9, max: 12 },
  IE: { min: 9, max: 9 },
  IL: { min: 8, max: 9 },
  IT: { min: 9, max: 10 },
  JP: { min: 10, max: 10 },
  KE: { min: 9, max: 9 },
  KR: { min: 9, max: 10 },
  KW: { min: 8, max: 8 },
  LK: { min: 9, max: 9 },
  MX: { min: 10, max: 10 },
  MY: { min: 9, max: 10 },
  NG: { min: 10, max: 10 },
  NL: { min: 9, max: 9 },
  NO: { min: 8, max: 8 },
  NP: { min: 10, max: 10 },
  NZ: { min: 8, max: 10 },
  OM: { min: 8, max: 8 },
  PH: { min: 10, max: 10 },
  PK: { min: 10, max: 10 },
  PL: { min: 9, max: 9 },
  PT: { min: 9, max: 9 },
  QA: { min: 8, max: 8 },
  RO: { min: 9, max: 9 },
  RU: { min: 10, max: 10 },
  SA: { min: 9, max: 9 },
  SE: { min: 9, max: 9 },
  SG: { min: 8, max: 8 },
  TH: { min: 9, max: 9 },
  TR: { min: 10, max: 10 },
  UA: { min: 9, max: 9 },
  US: { min: 10, max: 10 },
  VN: { min: 9, max: 9 },
  ZA: { min: 9, max: 9 },
}

const DEFAULT_NSN = { min: 7, max: 12 }

export function nsnLength(iso2: string): { min: number; max: number } {
  return NSN_LENGTH[iso2.toUpperCase()] ?? DEFAULT_NSN
}

/** Digits only, capped at this country's max (one extra digit allowed for a trunk 0). */
export function clampNationalDigits(iso2: string, input: string): string {
  const { max } = nsnLength(iso2)
  const digits = input.replace(/\D/g, '')
  const cap = digits.startsWith('0') ? max + 1 : max
  return digits.slice(0, cap)
}

export function isValidNationalLength(iso2: string, input: string): boolean {
  const { min, max } = nsnLength(iso2)
  const local = nationalDigits(input)
  return local.length >= min && local.length <= max
}

export function countryByIso2(iso2: string): DialCountry | undefined {
  return BY_ISO2.get(iso2.toUpperCase())
}

export function isKnownCountryIso2(iso2: string): boolean {
  return BY_ISO2.has(iso2.toUpperCase())
}

export function flagEmoji(iso2: string): string {
  const cc = iso2.toUpperCase()
  if (!/^[A-Z]{2}$/.test(cc)) return ''
  return String.fromCodePoint(
    ...[...cc].map((ch) => 127397 + ch.charCodeAt(0)),
  )
}

/** PNG flag that renders on Windows, where emoji flags often show as "IN". */
export function flagImageUrl(iso2: string, width = 40): string {
  return `https://flagcdn.com/w${width}/${iso2.toLowerCase()}.png`
}

export function nationalDigits(input: string): string {
  return sanitizePhoneForMeta(input).replace(/^0+/, '')
}

export function composeWhatsAppNumber(
  iso2: string,
  national: string,
): string | null {
  const country = countryByIso2(iso2)
  if (!country) return null
  let local = nationalDigits(national)
  // Pasting "919876543210" into the local box while +91 is selected
  // would otherwise store 91919876543210.
  if (
    local.startsWith(country.dial) &&
    local.length - country.dial.length >= nsnLength(country.iso2).min
  ) {
    local = local.slice(country.dial.length)
  }
  if (!isValidNationalLength(country.iso2, local)) return null
  return parseWhatsAppNumber(country.dial + local)
}

/**
 * Split stored digits into a known country + national number.
 * Longest dial prefix wins; +1 defaults to US. Unknown prefixes stay on India.
 */
export function splitWhatsAppNumber(input: string): {
  iso2: string
  national: string
} {
  const digits = sanitizePhoneForMeta(input)
  if (!digits) {
    return { iso2: DEFAULT_COUNTRY_ISO2, national: '' }
  }
  for (const country of DIAL_PREFIXES) {
    if (country.iso2 === 'CA') continue
    if (digits.startsWith(country.dial) && digits.length > country.dial.length) {
      return {
        iso2: country.iso2,
        national: digits.slice(country.dial.length),
      }
    }
  }
  return { iso2: DEFAULT_COUNTRY_ISO2, national: digits }
}

/** Display form, e.g. `+91 9876543210`. Empty input stays empty. */
export function formatWhatsAppDisplay(
  input: string | null | undefined,
): string {
  if (!input) return ''
  const { iso2, national } = splitWhatsAppNumber(input)
  const country = countryByIso2(iso2)
  if (!country || !national) {
    const digits = sanitizePhoneForMeta(input)
    return digits ? `+${digits}` : ''
  }
  return `+${country.dial} ${national}`
}
