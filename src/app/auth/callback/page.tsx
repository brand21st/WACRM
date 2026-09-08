'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

import { completeAuthCallback } from '@/lib/auth/complete-callback'
import { authCallbackLoginError } from '@/lib/auth/callback'

function callbackClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  return createBrowserClient(url, key, {
    isSingleton: false,
    auth: {
      detectSessionInUrl: false,
      persistSession: true,
      flowType: 'pkce',
    },
  })
}

function loginUrl(code: string): string {
  const login = new URL('/login', window.location.origin)
  login.searchParams.set('error', code)
  login.searchParams.set('error_description', authCallbackLoginError(code))
  return login.pathname + login.search
}

function AuthCallbackInner() {
  const search = useSearchParams()

  useEffect(() => {
    const supabase = callbackClient()
    if (!supabase) {
      window.location.replace(loginUrl('exchange_failed'))
      return
    }

    void completeAuthCallback(supabase, {
      code: search.get('code'),
      token_hash: search.get('token_hash'),
      type: search.get('type'),
      error: search.get('error'),
      error_code: search.get('error_code'),
      next: search.get('next'),
      invite: search.get('invite'),
    }).then((result) => {
      window.location.replace(
        result.ok ? result.dest : loginUrl(result.loginError),
      )
    })
  }, [search])

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-sm text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p>Signing you in…</p>
      </div>
    </div>
  )
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      }
    >
      <AuthCallbackInner />
    </Suspense>
  )
}
