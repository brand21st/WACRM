import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import {
  authCallbackLoginError,
  postAuthPath,
} from '@/lib/auth/callback'

/**
 * PKCE landing for email confirmation, Google OAuth, and password
 * reset. Exchanges `?code=` for a session, then redirects to a
 * same-origin allowlisted path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const oauthError = searchParams.get('error')
  if (oauthError) {
    return redirectToLogin(origin, oauthError)
  }

  const code = searchParams.get('code')
  if (!code) {
    return redirectToLogin(origin, 'missing_code')
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return redirectToLogin(origin, 'exchange_failed')
  }

  const cookieJar: {
    name: string
    value: string
    options: Record<string, unknown>
  }[] = []

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieJar.push({ name, value, options })
          })
        },
      },
    },
  )

  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return redirectToLogin(origin, 'exchange_failed')
  }

  const dest = postAuthPath({
    next: searchParams.get('next'),
    invite: searchParams.get('invite'),
    isPlatformAdmin: data.user?.app_metadata?.is_platform_admin === true,
  })
  const response = NextResponse.redirect(new URL(dest, origin))
  for (const cookie of cookieJar) {
    response.cookies.set(
      cookie.name,
      cookie.value,
      cookie.options as Parameters<typeof response.cookies.set>[2],
    )
  }
  return response
}

function redirectToLogin(origin: string, code: string): NextResponse {
  const login = new URL('/login', origin)
  login.searchParams.set('error', code)
  login.searchParams.set('error_description', authCallbackLoginError(code))
  return NextResponse.redirect(login)
}
