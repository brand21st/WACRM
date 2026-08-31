import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { normalizeShopDomain } from '@/lib/shopify/domain'
import { verifyShopifyOAuthHmac } from '@/lib/shopify/hmac'
import {
  exchangeAuthorizationCode,
  isApiSecretKey,
} from '@/lib/shopify/oauth'
import { verifyShopifyOAuthState } from '@/lib/shopify/oauth-state'
import {
  packInstalledShopifyCredential,
  resolveStoredClientId,
  unpackShopifyCredential,
} from '@/lib/shopify/credential-storage'
import { bootstrapShopifyCatalog } from '@/lib/shopify/bootstrap-catalog'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'

function appOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return new URL(request.url).origin
}

function redirectSettings(request: Request, query: string) {
  const base = `${appOrigin(request)}/settings?tab=shopify`
  return NextResponse.redirect(`${base}&${query}`)
}

function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * GET /api/shopify/oauth/callback
 *
 * OAuth redirect after installing the Partner app on a store. Expects
 * Client ID + API secret (shpss_) saved in Settings first.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const shop = normalizeShopDomain(url.searchParams.get('shop') ?? '')
  const code = url.searchParams.get('code')?.trim()
  const state = url.searchParams.get('state') ?? ''

  if (!shop || !code || !state) {
    return redirectSettings(request, 'shopify_error=missing_params')
  }

  const accountId = verifyShopifyOAuthState(state)
  if (!accountId) {
    return redirectSettings(request, 'shopify_error=invalid_state')
  }

  const supabase = supabaseAdmin()
  const { data: row, error } = await supabase
    .from('shopify_configs')
    .select('id, access_token, client_id')
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !row?.access_token) {
    return redirectSettings(request, 'shopify_error=not_configured')
  }

  let decrypted: string
  try {
    decrypted = decrypt(row.access_token)
  } catch {
    return redirectSettings(request, 'shopify_error=decrypt_failed')
  }

  const unpacked = unpackShopifyCredential(decrypted)
  const clientId = resolveStoredClientId(row.client_id, unpacked.clientId)
  const clientSecret = unpacked.credential

  if (!clientId || !isApiSecretKey(clientSecret)) {
    return redirectSettings(request, 'shopify_error=need_partner_secret')
  }

  if (!verifyShopifyOAuthHmac(url.searchParams, clientSecret)) {
    return redirectSettings(request, 'shopify_error=invalid_hmac')
  }

  try {
    const { accessToken } = await exchangeAuthorizationCode({
      shopDomain: shop,
      clientId,
      clientSecret,
      code,
    })

    const encrypted = encrypt(
      packInstalledShopifyCredential({
        clientId,
        accessToken,
        webhookSecret: isApiSecretKey(clientSecret) ? clientSecret : null,
      }),
    )
    const withClient = {
      shop_domain: shop,
      access_token: encrypted,
      client_id: clientId,
      last_verified_at: new Date().toISOString(),
    }
    const withoutClient = {
      shop_domain: shop,
      access_token: encrypted,
      last_verified_at: new Date().toISOString(),
    }

    let { error: updateErr } = await supabase
      .from('shopify_configs')
      .update(withClient)
      .eq('account_id', accountId)

    if (updateErr?.code === '42703' || updateErr?.code === 'PGRST204') {
      ;({ error: updateErr } = await supabase
        .from('shopify_configs')
        .update(withoutClient)
        .eq('account_id', accountId))
    }

    if (updateErr) {
      console.error('[shopify/oauth/callback] update failed:', updateErr)
      return redirectSettings(request, 'shopify_error=save_failed')
    }

    void bootstrapShopifyCatalog(supabase, accountId)

    return redirectSettings(request, 'shopify_installed=1')
  } catch (err) {
    console.error('[shopify/oauth/callback]', err)
    return redirectSettings(request, 'shopify_error=oauth_failed')
  }
}
