import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { encrypt } from '@/lib/whatsapp/encryption'
import { normalizeShopDomain } from '@/lib/shopify/domain'
import { packShopifyCredential } from '@/lib/shopify/credential-storage'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface Params {
  params: Promise<{ id: string }>
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:shop:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const shopDomain = normalizeShopDomain(
      typeof body?.shop_domain === 'string' ? body.shop_domain : '',
    )
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : ''
    if (!shopDomain) {
      return NextResponse.json({ error: 'shop_domain is required' }, { status: 400 })
    }

    const { data: existing } = await admin
      .from('shopify_configs')
      .select('id, access_token')
      .eq('account_id', id)
      .maybeSingle()

    if (!accessToken && !existing) {
      return NextResponse.json({ error: 'access_token is required' }, { status: 400 })
    }

    const row: Record<string, unknown> = {
      account_id: id,
      shop_domain: shopDomain,
      is_active: true,
      created_by: userId,
    }
    if (accessToken) {
      row.access_token = encrypt(packShopifyCredential(null, accessToken))
    }

    if (existing) {
      const { error } = await admin.from('shopify_configs').update(row).eq('id', existing.id)
      if (error) return NextResponse.json({ error: 'Failed to save Shopify' }, { status: 500 })
    } else {
      const { error } = await admin.from('shopify_configs').insert(row)
      if (error) return NextResponse.json({ error: 'Failed to save Shopify' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:shop-del:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const { error } = await admin.from('shopify_configs').delete().eq('account_id', id)
    if (error) return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
