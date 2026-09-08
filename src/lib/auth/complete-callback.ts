import type { SupabaseClient } from '@supabase/supabase-js'

import {
  authCallbackFailureCode,
  isEmailOtpType,
  postAuthPath,
} from '@/lib/auth/callback'
import { persistProfileWhatsApp } from '@/lib/auth/persist-whatsapp'

export type AuthCallbackParams = {
  code?: string | null
  token_hash?: string | null
  type?: string | null
  error?: string | null
  error_code?: string | null
  next?: string | null
  invite?: string | null
}

export type AuthCallbackResult =
  | { ok: true; dest: string }
  | { ok: false; loginError: string }

/**
 * Exchange a confirm / OAuth / recovery landing into a session, then
 * pick the post-auth path. Used by the browser callback page so the
 * PKCE verifier cookie (set at signup) is in the same storage.
 */
export async function completeAuthCallback(
  supabase: SupabaseClient,
  params: AuthCallbackParams,
): Promise<AuthCallbackResult> {
  const fail = authCallbackFailureCode({
    error: params.error,
    error_code: params.error_code,
  })
  if (fail) return { ok: false, loginError: fail }

  const tokenHash = params.token_hash?.trim() ?? ''
  const code = params.code?.trim() ?? ''

  let userId: string | null = null
  let isPlatformAdmin = false
  let whatsapp: unknown

  if (tokenHash && isEmailOtpType(params.type)) {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: params.type,
    })
    if (error) {
      console.error('[auth/callback] verifyOtp', error.message)
      return { ok: false, loginError: 'exchange_failed' }
    }
    userId = data.user?.id ?? null
    isPlatformAdmin = data.user?.app_metadata?.is_platform_admin === true
    whatsapp = data.user?.user_metadata?.whatsapp_number
  } else if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      console.error('[auth/callback] exchangeCodeForSession', error.message)
      return { ok: false, loginError: 'exchange_failed' }
    }
    userId = data.user?.id ?? null
    isPlatformAdmin = data.user?.app_metadata?.is_platform_admin === true
    whatsapp = data.user?.user_metadata?.whatsapp_number
  } else {
    return { ok: false, loginError: 'missing_code' }
  }

  if (userId) {
    try {
      await persistProfileWhatsApp(supabase, userId, whatsapp)
    } catch (err) {
      console.error('[auth/callback] persist WhatsApp', err)
    }
  }

  return {
    ok: true,
    dest: postAuthPath({
      next: params.next,
      invite: params.invite,
      isPlatformAdmin,
    }),
  }
}
