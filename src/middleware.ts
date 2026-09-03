import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import {
  APP_HOST,
  isCrmPath,
  isLandingHost,
  isWwwAppHost,
  normalizeHost,
} from '@/lib/hosts'

// Routes Meta/Shopify/cron hit without a browser session. Skip the
// Supabase getUser() round-trip — it can hang or slow webhook acks.
const PUBLIC_API_PREFIXES = [
  '/api/whatsapp/webhook',
  '/api/shopify/webhook',
  '/api/whatsapp/broadcast/cron',
  '/api/automations/cron',
  '/api/flows/cron',
  '/api/shopify/notifications/cron',
  '/api/voice/cron',
  '/api/ai/memory/cron',
  '/api/billing/cron',
  '/api/billing/razorpay/webhook',
]

// Public legal pages Meta's go-live crawler fetches (no session).
const PUBLIC_PAGE_PREFIXES = ['/privacy', '/terms', '/data-deletion']

function requestHostname(request: NextRequest): string {
  const forwarded = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
  return normalizeHost(forwarded || request.nextUrl.hostname)
}

function redirectToAppHost(request: NextRequest): NextResponse {
  const url = request.nextUrl.clone()
  url.protocol = 'https:'
  url.hostname = APP_HOST
  url.port = ''
  return NextResponse.redirect(url, 308)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next({ request })
  }

  const hostname = requestHostname(request)
  if (isWwwAppHost(hostname)) {
    return redirectToAppHost(request)
  }
  if (isLandingHost(hostname) && isCrmPath(pathname)) {
    return redirectToAppHost(request)
  }
  if (
    isLandingHost(hostname) &&
    (pathname === '/' ||
      PUBLIC_PAGE_PREFIXES.some(
        (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
      ))
  ) {
    return NextResponse.next({ request })
  }
  if (
    PUBLIC_PAGE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  ) {
    return NextResponse.next({ request })
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else if (user.app_metadata?.is_platform_admin === true) {
      url.pathname = '/super-admin'
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // App host `/` is the CRM entry, not a marketing page. Send
  // visitors to login or their home instead of a blind /dashboard
  // bounce that middleware would then rewrite anyway.
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.search = ''
    if (!user) {
      url.pathname = '/login'
    } else if (user.app_metadata?.is_platform_admin === true) {
      url.pathname = '/super-admin'
    } else {
      url.pathname = '/dashboard'
    }
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  const isPlatformAdmin = user?.app_metadata?.is_platform_admin === true
  const merchantPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
    '/calling',
    '/flows',
    '/agents',
    '/notifications',
  ]
  if (isPlatformAdmin && merchantPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    const url = request.nextUrl.clone()
    url.pathname = '/super-admin'
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }
  if (user && !isPlatformAdmin && pathname.startsWith('/super-admin')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [...merchantPaths, '/super-admin']
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return withRefreshedCookies(NextResponse.redirect(url))
  }

  // API routes that need auth (not webhooks or the scheduled-broadcast
  // drain — that authenticates with x-cron-secret inside the route).
  if (
    !user &&
    request.nextUrl.pathname.startsWith('/api/whatsapp/') &&
    !request.nextUrl.pathname.includes('/webhook') &&
    request.nextUrl.pathname !== '/api/whatsapp/broadcast/cron'
  ) {
    return withRefreshedCookies(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
