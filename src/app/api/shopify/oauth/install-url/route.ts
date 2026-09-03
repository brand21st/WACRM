import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { normalizeShopDomain } from '@/lib/shopify/domain'
import { signShopifyOAuthState } from '@/lib/shopify/oauth-state'
import { SHOPIFY_PARTNER_SCOPES } from '@/lib/shopify/scopes'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function appOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return new URL(request.url).origin
}

/**
 * POST /api/shopify/oauth/install-url  (admin+)
 *
 * Build the Shopify admin OAuth authorize URL for installing the Partner
 * app on a store. Client ID + API secret should be saved before callback.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const { assertShopifyConnect } = await import('@/lib/billing/entitlements')
    await assertShopifyConnect(accountId)
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const shopDomain = normalizeShopDomain(
      typeof body.shop_domain === 'string' ? body.shop_domain : '',
    )
    const clientId =
      typeof body.client_id === 'string' && body.client_id.trim()
        ? body.client_id.trim().slice(0, 128)
        : ''

    if (!shopDomain) return bad('shop_domain is required')
    if (!clientId) return bad('client_id is required')

    const origin = appOrigin(request)
    const redirectUri = `${origin}/api/shopify/oauth/callback`
    const state = signShopifyOAuthState(accountId)
    const installUrl = new URL(`https://${shopDomain}/admin/oauth/authorize`)
    installUrl.searchParams.set('client_id', clientId)
    installUrl.searchParams.set('scope', SHOPIFY_PARTNER_SCOPES)
    installUrl.searchParams.set('redirect_uri', redirectUri)
    installUrl.searchParams.set('state', state)

    return NextResponse.json({
      install_url: installUrl.toString(),
      redirect_uri: redirectUri,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
