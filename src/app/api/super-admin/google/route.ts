import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import { appOrigin } from '@/lib/google-sheets/config'
import {
  __resetPlatformGoogleSettingsCache,
  isGoogleClientId,
  resolveGoogleOAuthCredentials,
} from '@/lib/google-sheets/platform-settings'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function googlePayload(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
  request?: Request,
) {
  const [{ data, error }, creds] = await Promise.all([
    admin
      .from('platform_google_settings')
      .select('google_client_id, google_client_secret')
      .eq('id', 1)
      .maybeSingle(),
    resolveGoogleOAuthCredentials(),
  ])
  if (error) throw error
  return {
    google_client_id: data?.google_client_id ?? '',
    has_google_client_secret: Boolean(data?.google_client_secret),
    configured: creds.configured,
    source: creds.source,
    redirect_uri: request
      ? `${appOrigin(request)}/api/google/sheets/oauth/callback`
      : '',
  }
}

export async function GET(request: Request) {
  try {
    const { admin } = await requirePlatformAdmin()
    return NextResponse.json(await googlePayload(admin, request))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:google:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return bad('Invalid body')

    const patch: Record<string, unknown> = {}

    if ('google_client_id' in body) {
      if (body.google_client_id === null || body.google_client_id === '') {
        patch.google_client_id = null
      } else if (typeof body.google_client_id === 'string') {
        const clientId = body.google_client_id.trim()
        if (!isGoogleClientId(clientId)) {
          return bad('Client ID must look like ….apps.googleusercontent.com')
        }
        patch.google_client_id = clientId
      } else {
        return bad('Invalid google_client_id')
      }
    }

    if (body.google_client_secret === null) {
      patch.google_client_secret = null
    } else if (
      typeof body.google_client_secret === 'string' &&
      body.google_client_secret.trim()
    ) {
      patch.google_client_secret = encrypt(body.google_client_secret.trim())
    }

    const { error } = await admin
      .from('platform_google_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    if (error) {
      console.error('[super-admin/google PUT]', error)
      return NextResponse.json(
        { error: 'Failed to save Google OAuth settings' },
        { status: 500 },
      )
    }
    __resetPlatformGoogleSettingsCache()
    return NextResponse.json({ ok: true, ...(await googlePayload(admin, request)) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
