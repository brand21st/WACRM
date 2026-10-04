import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import {
  globalPostBusPublicPayload,
  upsertGlobalPostBusAccount,
} from '@/lib/postbus/global-admin'
import { POSTBUS_CONFIG_COLUMNS } from '@/lib/postbus/config'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin()
    const { data, error } = await admin
      .from('postbus_integrations')
      .select(POSTBUS_CONFIG_COLUMNS)
      .eq('routing_mode', 'global')
      .maybeSingle()
    if (error) {
      return NextResponse.json(
        { error: 'Failed to load PostBus sender' },
        { status: 500 },
      )
    }
    return NextResponse.json(await globalPostBusPublicPayload(admin, data))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:postbus:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      )
    }
    const accountId =
      typeof body.account_id === 'string' ? body.account_id.trim() : ''
    if (!accountId) {
      return NextResponse.json({ error: 'account_id is required' }, { status: 400 })
    }

    const saved = await upsertGlobalPostBusAccount(admin, {
      accountId,
      userId,
      body,
    })
    return NextResponse.json(await globalPostBusPublicPayload(admin, saved))
  } catch (err) {
    return toErrorResponse(err)
  }
}
