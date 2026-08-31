import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt, decrypt } from '@/lib/whatsapp/encryption'
import { shopifyGraphql, ShopifyError } from '@/lib/shopify/client'
import { resolveAdminAccessToken } from '@/lib/shopify/oauth'
import { SHOP_INFO_QUERY } from '@/lib/shopify/queries'
import { normalizeShopDomain } from '@/lib/shopify/domain'
import { adminAccessTokenHint } from '@/lib/shopify/validate-access-token'
import { isMissingClientIdColumn, isMissingDbColumn } from '@/lib/shopify/config-db'
import {
  packShopifyCredential,
  resolveStoredClientId,
  unpackShopifyCredential,
} from '@/lib/shopify/credential-storage'
import { bootstrapShopifyCatalog } from '@/lib/shopify/bootstrap-catalog'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

const CONFIG_COLUMNS =
  'shop_domain, access_token, is_active, shop_name, primary_domain, currency, client_id, meta_catalog_id, last_verified_at, last_catalog_sync_at, catalog_product_count, last_content_sync_at, content_item_count'

async function verifyShopCredentials(
  shopDomain: string,
  plaintext: string,
  clientId: string | null,
) {
  const accessToken = await resolveAdminAccessToken({
    shopDomain,
    clientId,
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

  return {
    shopName: data.shop?.name ?? null,
    primaryDomain: data.shop?.primaryDomain?.url ?? `https://${shopDomain}`,
    currency: data.shop?.currencyCode ?? null,
  }
}

async function persistShopifyConfig(
  supabase: SupabaseClient,
  args: {
    accountId: string
    userId: string
    existingId: string | null
    shopDomain: string
    plaintext: string
    isActive: boolean
    clientId: string | null
    metaCatalogId: string | null
    shopName: string | null
    primaryDomain: string | null
    currency: string | null
  },
) {
  const base = {
    shop_domain: args.shopDomain,
    access_token: encrypt(
      packShopifyCredential(args.clientId, args.plaintext),
    ),
    is_active: args.isActive,
    shop_name: args.shopName,
    primary_domain: args.primaryDomain,
    currency: args.currency,
    meta_catalog_id: args.metaCatalogId,
    last_verified_at: new Date().toISOString(),
  }
  const withClientId = { ...base, client_id: args.clientId }
  const withoutClientId = base

  if (args.existingId) {
    let { error } = await supabase
      .from('shopify_configs')
      .update(withClientId)
      .eq('account_id', args.accountId)
    if (error && isMissingClientIdColumn(error)) {
      ;({ error } = await supabase
        .from('shopify_configs')
        .update(withoutClientId)
        .eq('account_id', args.accountId))
    }
    return error
  }

  let { error } = await supabase.from('shopify_configs').insert({
    account_id: args.accountId,
    created_by: args.userId,
    ...withClientId,
  })
  if (error && isMissingClientIdColumn(error)) {
    ;({ error } = await supabase.from('shopify_configs').insert({
      account_id: args.accountId,
      created_by: args.userId,
      ...withoutClientId,
    }))
  }
  return error
}

/**
 * GET /api/shopify/config
 *
 * Members may read connection status. The Admin API token is never
 * returned — only `has_token`.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    let { data, error } = await supabase
      .from('shopify_configs')
      .select(CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error && isMissingClientIdColumn(error)) {
      ;({ data, error } = await supabase
        .from('shopify_configs')
        .select(
          'shop_domain, access_token, is_active, shop_name, primary_domain, currency, meta_catalog_id, last_verified_at, last_catalog_sync_at, catalog_product_count',
        )
        .eq('account_id', accountId)
        .maybeSingle())
    }

    if (
      error &&
      (isMissingDbColumn(error, 'last_content_sync_at') ||
        isMissingDbColumn(error, 'content_item_count'))
    ) {
      ;({ data, error } = await supabase
        .from('shopify_configs')
        .select(
          'shop_domain, access_token, is_active, shop_name, primary_domain, currency, client_id, meta_catalog_id, last_verified_at, last_catalog_sync_at, catalog_product_count',
        )
        .eq('account_id', accountId)
        .maybeSingle())
    }

    if (error) {
      console.error('[shopify/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load Shopify configuration' },
        { status: 500 },
      )
    }
    if (!data) return NextResponse.json({ configured: false })

    const { access_token, ...safe } = data
    let clientId =
      typeof safe.client_id === 'string' && safe.client_id.trim()
        ? safe.client_id.trim()
        : null
    if (!clientId && access_token) {
      try {
        const unpacked = unpackShopifyCredential(decrypt(access_token))
        clientId = unpacked.clientId
      } catch {
        // ignore — token may be unreadable on this instance
      }
    }

    return NextResponse.json({
      configured: true,
      has_token: Boolean(access_token),
      ...safe,
      client_id: clientId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * POST /api/shopify/config  (admin+)
 *
 * Save shop domain + Admin API token. Verifies with Shopify before
 * persisting. Omit `access_token` to keep the stored token.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`shopify-config:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return bad('Invalid request body')

    const shopDomain = normalizeShopDomain(
      typeof body.shop_domain === 'string' ? body.shop_domain : '',
    )
    if (!shopDomain) {
      return bad('shop_domain must be a myshopify.com subdomain')
    }

    const isActive = body.is_active !== false
    const metaCatalogId =
      typeof body.meta_catalog_id === 'string' && body.meta_catalog_id.trim()
        ? body.meta_catalog_id.trim()
        : null

    const clientId =
      typeof body.client_id === 'string' && body.client_id.trim()
        ? body.client_id.trim().slice(0, 128)
        : null

    const incomingToken =
      typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const tokenEdited = incomingToken && !incomingToken.includes('•')

    let { data: existingRow, error: existingErr } = await supabase
      .from('shopify_configs')
      .select('id, access_token, client_id')
      .eq('account_id', accountId)
      .maybeSingle()

    if (existingErr && isMissingClientIdColumn(existingErr)) {
      ;({ data: existingRow } = await supabase
        .from('shopify_configs')
        .select('id, access_token')
        .eq('account_id', accountId)
        .maybeSingle())
    }

    let existingClientId: string | null = null
    if (existingRow && 'client_id' in existingRow) {
      const raw = (existingRow as { client_id?: string | null }).client_id
      existingClientId =
        typeof raw === 'string' && raw.trim() ? raw.trim().slice(0, 128) : null
    }

    let plaintext: string
    if (tokenEdited) {
      plaintext = incomingToken
    } else if (existingRow?.access_token) {
      try {
        const unpacked = unpackShopifyCredential(decrypt(existingRow.access_token))
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

    let shopName: string | null = null
    let primaryDomain: string | null = null
    let currency: string | null = null
    try {
      const verified = await verifyShopCredentials(
        shopDomain,
        plaintext,
        resolvedClientId,
      )
      shopName = verified.shopName
      primaryDomain = verified.primaryDomain
      currency = verified.currency
    } catch (err) {
      if (err instanceof ShopifyError) {
        return NextResponse.json({ error: err.message }, { status: err.status })
      }
      throw err
    }

    const error = await persistShopifyConfig(supabase, {
      accountId,
      userId,
      existingId: existingRow?.id ?? null,
      shopDomain,
      plaintext,
      isActive,
      clientId: resolvedClientId,
      metaCatalogId,
      shopName,
      primaryDomain,
      currency,
    })
    if (error) {
      console.error('[shopify/config POST] persist error:', error)
      return NextResponse.json(
        { error: 'Failed to save Shopify configuration' },
        { status: 500 },
      )
    }

    void bootstrapShopifyCatalog(supabase, accountId)

    return NextResponse.json({
      success: true,
      configured: true,
      has_token: true,
      shop_domain: shopDomain,
      shop_name: shopName,
      primary_domain: primaryDomain,
      currency,
      is_active: isActive,
      client_id: resolvedClientId,
      meta_catalog_id: metaCatalogId,
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    await supabase
      .from('shopify_catalog_products')
      .delete()
      .eq('account_id', accountId)
    await supabase
      .from('shopify_store_content')
      .delete()
      .eq('account_id', accountId)
    const { error } = await supabase
      .from('shopify_configs')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[shopify/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect Shopify' },
        { status: 500 },
      )
    }
    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
