import { NextResponse, type NextRequest } from 'next/server'

const LOCAL_DEV_ORIGINS = new Set([
  'http://localhost:8081',
  'http://localhost:8082',
  'http://localhost:19006',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:8082',
  'http://127.0.0.1:19006',
])

function isAllowedMobileOrigin(origin: string): boolean {
  if (LOCAL_DEV_ORIGINS.has(origin)) return true
  try {
    const url = new URL(origin)
    return url.protocol === 'https:' && url.hostname.endsWith('.expo.dev')
  } catch {
    return false
  }
}

/** CORS headers for the Expo / Vachat mobile web client (Bearer auth, no cookies). */
export function mobileCorsHeaders(
  request: NextRequest,
): Record<string, string> | null {
  const origin = request.headers.get('origin')
  if (!origin || !isAllowedMobileOrigin(origin)) return null
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function isMobileCorsPreflight(request: NextRequest): boolean {
  return request.method === 'OPTIONS'
}

export function withMobileCors(
  request: NextRequest,
  response: NextResponse,
): NextResponse {
  const cors = mobileCorsHeaders(request)
  if (!cors) return response
  for (const [key, value] of Object.entries(cors)) {
    response.headers.set(key, value)
  }
  return response
}

export function mobileCorsOptionsResponse(request: NextRequest): NextResponse | null {
  if (!isMobileCorsPreflight(request)) return null
  const cors = mobileCorsHeaders(request)
  if (!cors) return null
  return new NextResponse(null, { status: 204, headers: cors })
}
