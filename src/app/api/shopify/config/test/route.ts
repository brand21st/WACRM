import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import { resolveAdminAccessToken } from '@/lib/shopify/oauth'
import { SHOP_INFO_QUERY } from '@/lib/shopify/queries'
import { normalizeShopDomain } from '@/lib/shopify/domain'
import { adminAccessTokenHint } from '@/lib/shopify/validate-access-token'
import { isMissingClientIdColumn } from '@/lib/shopify/config-db'
import {
  resolveStoredClientId,
  unpackShopifyCredential,
} from '@/lib/shopify/credential-storage'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

/**
 * POST /api/shopify/config/test  (admin+)
 *
 * Verify shop domain + Admin API token against Shopify without writing
 * to the database.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`shopify-config-test:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const shopDomain = normalizeShopDomain(
      typeof body.shop_domain === 'string' ? body.shop_domain : '',
    )
    if (!shopDomain) {
      return bad('shop_domain must be a myshopify.com subdomain')
    }

    const clientId =
      typeof body.client_id === 'string' && body.client_id.trim()
        ? body.client_id.trim().slice(0, 128)
        : null

    const incomingToken =
      typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const tokenEdited = incomingToken && !incomingToken.includes('•')

    let { data: existing, error: existingErr } = await supabase
      .from('shopify_configs')
      .select('access_token, client_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingErr && isMissingClientIdColumn(existingErr)) {
      ;({ data: existing } = await supabase
        .from('shopify_configs')
        .select('access_token')
        .eq('account_id', accountId)
        .maybeSingle())
    }

    let existingClientId: string | null = null
    if (existing && 'client_id' in existing) {
      const raw = (existing as { client_id?: string | null }).client_id
      existingClientId =
        typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 128) : null
    }

    let plaintext: string
    if (tokenEdited) {
      plaintext = incomingToken
    } else if (existing?.access_token) {
      try {
        const unpacked = unpackShopifyCredential(decrypt(existing.access_token))
        plaintext = unpacked.credential
        existingClientId = resolveStoredClientId(existingClientId, unpacked.clientId)
      } catch {
        return bad('Stored token could not be decrypted. Paste a new Admin API token.')
      }
    } else {
      return bad('access_token is required')
    }

    const resolvedClientId = resolveStoredClientId(clientId, existingClientId)

    const tokenHint = adminAccessTokenHint(plaintext, resolvedClientId)
    if (tokenHint) return bad(tokenHint)

    try {
      const accessToken = await resolveAdminAccessToken({
        shopDomain,
        clientId: resolvedClientId,
        credential: plaintext,
      })
      const data = await shopifyGraphql<{
        shop?: {
          name?: string
          currencyCode?: string
          primaryDomain?: { url?: string | null } | null
        }
      }>({
        shopDomain,
        accessToken,
        query: SHOP_INFO_QUERY,
      })

      const shopName = data.shop?.name ?? null
      const primaryDomain =
        data.shop?.primaryDomain?.url ?? `https://${shopDomain}`
      const currency = data.shop?.currencyCode ?? null

      return NextResponse.json({
        success: true,
        shop_domain: shopDomain,
        shop_name: shopName,
        primary_domain: primaryDomain,
        currency,
      })
    } catch (err) {
      if (err instanceof ShopifyError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}
