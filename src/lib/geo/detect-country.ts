import {
  DEFAULT_COUNTRY_ISO2,
  isKnownCountryIso2,
} from '@/lib/geo/dial-codes'

const GEO_HEADER_KEYS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'cloudfront-viewer-country',
  'fastly-client-country-code',
  'x-country-code',
]

const IGNORED_GEO = new Set(['', 'XX', 'T1', 'A1', 'A2', 'O1'])

/**
 * Common IANA zones for countries in `DIAL_COUNTRIES`.
 * Unknown zones fall through to locale, then India.
 */
const TIMEZONE_TO_ISO2: Record<string, string> = {
  'Asia/Kolkata': 'IN',
  'Asia/Calcutta': 'IN',
  'Asia/Dubai': 'AE',
  'Asia/Muscat': 'OM',
  'Asia/Qatar': 'QA',
  'Asia/Bahrain': 'BH',
  'Asia/Kuwait': 'KW',
  'Asia/Riyadh': 'SA',
  'Asia/Karachi': 'PK',
  'Asia/Dhaka': 'BD',
  'Asia/Colombo': 'LK',
  'Asia/Kathmandu': 'NP',
  'Asia/Singapore': 'SG',
  'Asia/Kuala_Lumpur': 'MY',
  'Asia/Jakarta': 'ID',
  'Asia/Makassar': 'ID',
  'Asia/Manila': 'PH',
  'Asia/Bangkok': 'TH',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Saigon': 'VN',
  'Asia/Hong_Kong': 'HK',
  'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP',
  'Asia/Seoul': 'KR',
  'Asia/Jerusalem': 'IL',
  'Asia/Istanbul': 'TR',
  'Europe/Istanbul': 'TR',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR',
  'Europe/Berlin': 'DE',
  'Europe/Rome': 'IT',
  'Europe/Madrid': 'ES',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Zurich': 'CH',
  'Europe/Vienna': 'AT',
  'Europe/Stockholm': 'SE',
  'Europe/Oslo': 'NO',
  'Europe/Copenhagen': 'DK',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Lisbon': 'PT',
  'Europe/Bucharest': 'RO',
  'Europe/Kyiv': 'UA',
  'Europe/Kiev': 'UA',
  'Europe/Moscow': 'RU',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Phoenix': 'US',
  'America/Toronto': 'CA',
  'America/Vancouver': 'CA',
  'America/Sao_Paulo': 'BR',
  'America/Mexico_City': 'MX',
  'America/Argentina/Buenos_Aires': 'AR',
  'Africa/Cairo': 'EG',
  'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE',
  'Africa/Johannesburg': 'ZA',
  'Africa/Accra': 'GH',
  'Australia/Sydney': 'AU',
  'Australia/Melbourne': 'AU',
  'Pacific/Auckland': 'NZ',
}

export function countryFromTimeZone(timeZone: string): string | null {
  const iso2 = TIMEZONE_TO_ISO2[timeZone]
  return iso2 && isKnownCountryIso2(iso2) ? iso2 : null
}

export function countryFromLocale(tag: string): string | null {
  try {
    const locale = new Intl.Locale(tag)
    const region = locale.region ?? locale.maximize().region
    if (region && isKnownCountryIso2(region)) return region
  } catch {
    return null
  }
  return null
}

export function detectCountryFromBrowser(opts?: {
  timeZone?: string
  languages?: readonly string[]
}): string {
  const timeZone =
    opts?.timeZone ??
    (typeof Intl === 'undefined'
      ? ''
      : Intl.DateTimeFormat().resolvedOptions().timeZone)
  const fromTz = timeZone ? countryFromTimeZone(timeZone) : null
  if (fromTz) return fromTz

  const languages =
    opts?.languages ??
    (typeof navigator === 'undefined' ? [] : navigator.languages)
  for (const tag of languages) {
    const fromLang = countryFromLocale(tag)
    if (fromLang) return fromLang
  }
  return DEFAULT_COUNTRY_ISO2
}

export function normalizeGeoIso2(raw: string | null | undefined): string | null {
  const iso2 = (raw ?? '').trim().toUpperCase()
  if (IGNORED_GEO.has(iso2) || !isKnownCountryIso2(iso2)) return null
  return iso2
}

export function iso2FromGeoHeaders(
  getHeader: (name: string) => string | null,
): string | null {
  for (const key of GEO_HEADER_KEYS) {
    const iso2 = normalizeGeoIso2(getHeader(key))
    if (iso2) return iso2
  }
  return null
}

export function clientIpFromHeaders(
  getHeader: (name: string) => string | null,
): string | null {
  const forwarded = getHeader('cf-connecting-ip') || getHeader('x-real-ip')
  if (forwarded && isPublicIp(forwarded.trim())) return forwarded.trim()

  const xff = getHeader('x-forwarded-for')
  if (!xff) return null
  for (const part of xff.split(',')) {
    const ip = part.trim()
    if (isPublicIp(ip)) return ip
  }
  return null
}

export function isPublicIp(ip: string): boolean {
  if (!ip) return false
  if (ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0') return false
  if (ip.startsWith('10.')) return false
  if (ip.startsWith('192.168.')) return false
  if (ip.startsWith('169.254.')) return false
  const m = ip.match(/^172\.(\d+)\./)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return false
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80')) {
    return false
  }
  return true
}

export async function lookupCountryFromIp(
  ip: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (!isPublicIp(ip)) return null
  try {
    const res = await fetchImpl(
      `https://api.country.is/${encodeURIComponent(ip)}`,
      { signal: AbortSignal.timeout(1500) },
    )
    if (!res.ok) return null
    const body = (await res.json()) as { country?: unknown }
    return typeof body.country === 'string'
      ? normalizeGeoIso2(body.country)
      : null
  } catch {
    return null
  }
}
