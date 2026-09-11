import { createServerClient } from '@supabase/ssr'
import { cookies, headers } from 'next/headers'

import { parseBearerAccessToken } from '@/lib/auth/bearer'

export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}

/**
 * RLS-scoped client for a Supabase user JWT (Expo / mobile).
 * Uses the public anon key plus the caller's access token — never
 * the service-role key.
 */
export function createBearerClient(accessToken: string) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {
          // Bearer sessions are not stored in cookies.
        },
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    },
  )
}

/**
 * Cookie session (web) or Bearer user JWT (mobile).
 * API keys are rejected by {@link parseBearerAccessToken}.
 */
export async function createRequestClient() {
  const headerStore = await headers()
  const token = parseBearerAccessToken(headerStore.get('authorization'))
  if (token) return createBearerClient(token)
  return createClient()
}
