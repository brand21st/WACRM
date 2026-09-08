import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { appOrigin } from '@/lib/google-sheets/config'
import {
  buildGoogleAuthorizeUrl,
  GoogleOAuthError,
} from '@/lib/google-sheets/oauth'
import { signGoogleOAuthState } from '@/lib/google-sheets/oauth-state'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/google/sheets/oauth/connect  (admin+)
 *
 * Build the Google OAuth authorize URL for this workspace.
 */
export async function POST(request: Request) {
  try {
    const { accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `google-sheets-connect:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const redirectUri = `${appOrigin(request)}/api/google/sheets/oauth/callback`
    const state = signGoogleOAuthState(accountId, userId)
    const authorizeUrl = buildGoogleAuthorizeUrl({ redirectUri, state })

    return NextResponse.json({
      authorize_url: authorizeUrl,
      redirect_uri: redirectUri,
    })
  } catch (err) {
    if (err instanceof GoogleOAuthError && err.code === 'not_configured') {
      return NextResponse.json(
        { error: 'Google Sheets is not configured on this server' },
        { status: 503 },
      )
    }
    return toErrorResponse(err)
  }
}
