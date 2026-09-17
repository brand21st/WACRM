import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  connectFromFacebookCode,
  connectFromManualToken,
  connectFromUserToken,
  MetaConnectError,
} from '@/lib/meta/connect'
import { MetaApiError } from '@/lib/whatsapp/meta-api'
import { createClient as createAdminClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

function publicConnection(row: {
  page_id: string
  page_name: string | null
  ig_user_id: string | null
  ig_username: string | null
  messenger_status: string
  instagram_status: string
  subscribed_apps_at: string | null
  connected_at: string | null
  onboarding_source: string
  last_error: string | null
  token_expires_at: string | null
}) {
  return {
    connected:
      row.messenger_status === 'connected' || row.instagram_status === 'connected',
    page_id: row.page_id,
    page_name: row.page_name,
    ig_user_id: row.ig_user_id,
    ig_username: row.ig_username,
    messenger_status: row.messenger_status,
    instagram_status: row.instagram_status,
    subscribed_apps_at: row.subscribed_apps_at,
    connected_at: row.connected_at,
    onboarding_source: row.onboarding_source,
    last_error: row.last_error,
    token_expires_at: row.token_expires_at,
  }
}

export async function GET() {
  try {
    const { accountId } = await requireRole('viewer')
    const { data, error } = await supabaseAdmin()
      .from('meta_page_connections')
      .select(
        'page_id, page_name, ig_user_id, ig_username, messenger_status, instagram_status, subscribed_apps_at, connected_at, onboarding_source, last_error, token_expires_at',
      )
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) {
      console.error('[meta/connect GET]', error)
      return NextResponse.json({ connected: false, reason: 'db_error' })
    }
    if (!data) {
      return NextResponse.json({ connected: false, reason: 'no_config' })
    }
    return NextResponse.json(publicConnection(data))
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 })
    }

    const code = typeof body.code === 'string' ? body.code.trim() : ''
    const userAccessToken =
      typeof body.user_access_token === 'string'
        ? body.user_access_token.trim()
        : ''
    const pageId = typeof body.page_id === 'string' ? body.page_id.trim() : ''
    const accessToken =
      typeof body.access_token === 'string' ? body.access_token.trim() : ''
    const verifyToken =
      typeof body.verify_token === 'string' ? body.verify_token.trim() : ''
    const redirectUri =
      typeof body.redirect_uri === 'string' ? body.redirect_uri.trim() : undefined
    const replace = body.replace === true

    if (!replace) {
      const { data: existing } = await supabaseAdmin()
        .from('meta_page_connections')
        .select('page_id, page_name')
        .eq('account_id', accountId)
        .maybeSingle()
      if (existing && pageId && existing.page_id !== pageId) {
        return NextResponse.json(
          {
            error: 'A different Facebook Page is already connected.',
            current_page_id: existing.page_id,
            current_page_name: existing.page_name,
            needs_replace: true,
          },
          { status: 409 },
        )
      }
    }

    const result = code
      ? await connectFromFacebookCode({
          accountId,
          userId,
          code,
          redirectUri,
          pageId: pageId || undefined,
        })
      : userAccessToken
        ? await connectFromUserToken({
            accountId,
            userId,
            userAccessToken,
            pageId: pageId || undefined,
          })
        : pageId && accessToken
          ? await connectFromManualToken({
              accountId,
              userId,
              pageId,
              pageAccessToken: accessToken,
              verifyToken: verifyToken || null,
            })
          : null

    if (!result) {
      return NextResponse.json(
        {
          error:
            'Provide a Facebook login code, a Facebook user token, or a Page ID and token.',
        },
        { status: 400 },
      )
    }

    return NextResponse.json({
      connected: true,
      page_id: result.pageId,
      page_name: result.pageName,
      ig_username: result.igUsername,
      messenger_status: result.messengerStatus,
      instagram_status: result.instagramStatus,
      subscribed_apps_at: result.subscribedAppsAt,
      last_error: result.lastError,
    })
  } catch (err) {
    if (err instanceof MetaConnectError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    if (err instanceof MetaApiError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    return toErrorResponse(err)
  }
}

export async function DELETE() {
  try {
    const { accountId } = await requireRole('admin')
    const { error } = await supabaseAdmin()
      .from('meta_page_connections')
      .delete()
      .eq('account_id', accountId)
    if (error) {
      console.error('[meta/connect DELETE]', error)
      return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 })
    }
    return NextResponse.json({ connected: false })
  } catch (err) {
    return toErrorResponse(err)
  }
}
