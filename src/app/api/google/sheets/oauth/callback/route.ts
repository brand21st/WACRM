import { NextResponse } from 'next/server'

import { appOrigin, supabaseAdmin } from '@/lib/google-sheets/config'
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserInfo,
  GoogleOAuthError,
} from '@/lib/google-sheets/oauth'
import { verifyGoogleOAuthState } from '@/lib/google-sheets/oauth-state'
import { encryptGoogleToken } from '@/lib/google-sheets/tokens'

function redirectIntegrations(request: Request, query: string) {
  const base = `${appOrigin(request)}/settings?tab=integrations`
  return NextResponse.redirect(`${base}&${query}`)
}

/**
 * GET /api/google/sheets/oauth/callback
 *
 * Google redirects here after consent. Tokens are encrypted and stored
 * against the account bound in `state`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const denied = url.searchParams.get('error')
  if (denied) {
    const code = denied === 'access_denied' ? 'access_denied' : 'oauth_failed'
    return redirectIntegrations(request, `sheets_error=${code}`)
  }

  const code = url.searchParams.get('code')?.trim()
  const state = url.searchParams.get('state') ?? ''
  if (!code || !state) {
    return redirectIntegrations(request, 'sheets_error=missing_params')
  }

  const verified = verifyGoogleOAuthState(state)
  if (!verified) {
    return redirectIntegrations(request, 'sheets_error=invalid_state')
  }

  const redirectUri = `${appOrigin(request)}/api/google/sheets/oauth/callback`

  try {
    const tokens = await exchangeGoogleAuthorizationCode({
      code,
      redirectUri,
    })
    if (!tokens.refreshToken) {
      return redirectIntegrations(request, 'sheets_error=oauth_failed')
    }
    const userInfo = await fetchGoogleUserInfo(tokens.accessToken)

    const supabase = supabaseAdmin()
    const { data: existing } = await supabase
      .from('google_sheets_configs')
      .select('id')
      .eq('account_id', verified.accountId)
      .maybeSingle()

    const payload = {
      google_email: userInfo.email,
      google_account_id: userInfo.id,
      access_token: encryptGoogleToken(tokens.accessToken),
      refresh_token: encryptGoogleToken(tokens.refreshToken),
      token_expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      status: 'connected',
    }

    if (existing?.id) {
      const { error } = await supabase
        .from('google_sheets_configs')
        .update(payload)
        .eq('account_id', verified.accountId)
      if (error) {
        console.error('[google/sheets/oauth/callback] update failed:', error)
        return redirectIntegrations(request, 'sheets_error=save_failed')
      }
    } else {
      const { error } = await supabase.from('google_sheets_configs').insert([
        {
          account_id: verified.accountId,
          created_by: verified.userId,
          ...payload,
        },
      ])
      if (error) {
        console.error('[google/sheets/oauth/callback] insert failed:', error)
        return redirectIntegrations(request, 'sheets_error=save_failed')
      }
    }

    return redirectIntegrations(request, 'sheets=connected')
  } catch (err) {
    console.error('[google/sheets/oauth/callback]', err)
    if (err instanceof GoogleOAuthError && err.code === 'not_configured') {
      return redirectIntegrations(request, 'sheets_error=not_configured')
    }
    return redirectIntegrations(request, 'sheets_error=oauth_failed')
  }
}
