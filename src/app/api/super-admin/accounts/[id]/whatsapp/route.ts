import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { encrypt } from '@/lib/whatsapp/encryption'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface Params {
  params: Promise<{ id: string }>
}

export async function PUT(request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:wa:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const phoneNumberId =
      typeof body?.phone_number_id === 'string' ? body.phone_number_id.trim() : ''
    const accessToken =
      typeof body?.access_token === 'string' ? body.access_token.trim() : ''
    const wabaId =
      typeof body?.waba_id === 'string' ? body.waba_id.trim() || null : null
    const verifyToken =
      typeof body?.verify_token === 'string' ? body.verify_token.trim() || null : null

    if (!phoneNumberId) {
      return NextResponse.json({ error: 'phone_number_id is required' }, { status: 400 })
    }

    const { data: existing } = await admin
      .from('whatsapp_config')
      .select('id, access_token, user_id')
      .eq('account_id', id)
      .maybeSingle()

    let token = accessToken
    if (!token && existing?.access_token) {
      token = ''
    }
    if (!token && !existing) {
      return NextResponse.json({ error: 'access_token is required' }, { status: 400 })
    }

    if (token) {
      try {
        await verifyPhoneNumber({ phoneNumberId, accessToken: token })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Meta API error'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }

    const { data: owner } = await admin
      .from('accounts')
      .select('owner_user_id')
      .eq('id', id)
      .maybeSingle()

    const row = {
      account_id: id,
      user_id: existing?.user_id ?? owner?.owner_user_id ?? userId,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      verify_token: verifyToken,
      status: 'connected',
      connected_at: new Date().toISOString(),
      ...(token ? { access_token: encrypt(token) } : {}),
    }

    if (existing) {
      const { error } = await admin.from('whatsapp_config').update(row).eq('id', existing.id)
      if (error) return NextResponse.json({ error: 'Failed to save WhatsApp' }, { status: 500 })
    } else {
      const { error } = await admin.from('whatsapp_config').insert(row)
      if (error) return NextResponse.json({ error: 'Failed to save WhatsApp' }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:wa-del:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)
    const { id } = await params
    const { error } = await admin.from('whatsapp_config').delete().eq('account_id', id)
    if (error) return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
