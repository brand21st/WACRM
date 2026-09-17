import { NextResponse } from 'next/server'

import { toErrorResponse } from '@/lib/auth/account'
import { requirePlatformAdmin } from '@/lib/auth/platform-admin'
import {
  __resetPlatformMetaSettingsCache,
  isFacebookAppId,
  isFacebookLoginConfigId,
  resolveFacebookLoginConfig,
} from '@/lib/meta/platform-settings'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { encrypt } from '@/lib/whatsapp/encryption'

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function metaPayload(
  admin: Awaited<ReturnType<typeof requirePlatformAdmin>>['admin'],
) {
  const [{ data, error }, creds] = await Promise.all([
    admin
      .from('platform_meta_settings')
      .select('facebook_app_id, facebook_login_config_id, facebook_app_secret')
      .eq('id', 1)
      .maybeSingle(),
    resolveFacebookLoginConfig(),
  ])
  if (error) throw error
  return {
    facebook_app_id: data?.facebook_app_id ?? '',
    facebook_login_config_id: data?.facebook_login_config_id ?? '',
    has_facebook_app_secret: Boolean(data?.facebook_app_secret),
    configured: creds.configured,
    source: creds.source,
  }
}

export async function GET() {
  try {
    const { admin } = await requirePlatformAdmin()
    return NextResponse.json(await metaPayload(admin))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PUT(request: Request) {
  try {
    const { admin, userId } = await requirePlatformAdmin()
    const limit = checkRateLimit(`super-admin:meta:${userId}`, RATE_LIMITS.adminAction)
    if (!limit.success) return rateLimitResponse(limit)

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return bad('Invalid body')

    const patch: Record<string, unknown> = {}

    if ('facebook_app_id' in body) {
      if (body.facebook_app_id === null || body.facebook_app_id === '') {
        patch.facebook_app_id = null
      } else if (typeof body.facebook_app_id === 'string') {
        const appId = body.facebook_app_id.trim()
        if (!isFacebookAppId(appId)) {
          return bad('Facebook App ID must be digits only')
        }
        patch.facebook_app_id = appId
      } else {
        return bad('Invalid facebook_app_id')
      }
    }

    if ('facebook_login_config_id' in body) {
      if (
        body.facebook_login_config_id === null ||
        body.facebook_login_config_id === ''
      ) {
        patch.facebook_login_config_id = null
      } else if (typeof body.facebook_login_config_id === 'string') {
        const configId = body.facebook_login_config_id.trim()
        if (!isFacebookLoginConfigId(configId)) {
          return bad('Facebook Login configuration ID looks invalid')
        }
        patch.facebook_login_config_id = configId
      } else {
        return bad('Invalid facebook_login_config_id')
      }
    }

    if (body.facebook_app_secret === null) {
      patch.facebook_app_secret = null
    } else if (
      typeof body.facebook_app_secret === 'string' &&
      body.facebook_app_secret.trim()
    ) {
      patch.facebook_app_secret = encrypt(body.facebook_app_secret.trim())
    }

    const { error } = await admin
      .from('platform_meta_settings')
      .upsert({ id: 1, ...patch }, { onConflict: 'id' })
    if (error) {
      console.error('[super-admin/meta PUT]', error)
      return NextResponse.json(
        { error: 'Failed to save Facebook Login settings' },
        { status: 500 },
      )
    }
    __resetPlatformMetaSettingsCache()
    return NextResponse.json({ ok: true, ...(await metaPayload(admin)) })
  } catch (err) {
    return toErrorResponse(err)
  }
}
