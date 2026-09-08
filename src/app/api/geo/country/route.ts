import { NextResponse } from 'next/server'
import {
  clientIpFromHeaders,
  iso2FromGeoHeaders,
  lookupCountryFromIp,
} from '@/lib/geo/detect-country'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(request: Request) {
  const getHeader = (name: string) => request.headers.get(name)
  const ip = clientIpFromHeaders(getHeader) ?? 'unknown'
  const limited = checkRateLimit(`geo-country:${ip}`, RATE_LIMITS.geoCountry)
  if (!limited.success) return rateLimitResponse(limited)

  const fromHeader = iso2FromGeoHeaders(getHeader)
  if (fromHeader) {
    return NextResponse.json(
      { iso2: fromHeader, source: 'header' },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  const fromIp = ip === 'unknown' ? null : await lookupCountryFromIp(ip)
  return NextResponse.json(
    { iso2: fromIp, source: fromIp ? 'ip' : 'none' },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
