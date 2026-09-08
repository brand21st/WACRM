import { NextResponse } from 'next/server'

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import {
  GOOGLE_SHEETS_CONFIG_COLUMNS,
  supabaseAdmin,
  toPublicConnection,
  tokenNeedsRefresh,
  type GoogleSheetsConfigRow,
} from '@/lib/google-sheets/config'
import {
  GoogleOAuthError,
  refreshGoogleAccessToken,
  revokeGoogleToken,
} from '@/lib/google-sheets/oauth'
import { decryptGoogleToken, encryptGoogleToken } from '@/lib/google-sheets/tokens'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * GET /api/google/sheets/config
 *
 * Members may read connection status. Access / refresh tokens are
 * never returned.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('google_sheets_configs')
      .select(GOOGLE_SHEETS_CONFIG_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) {
      console.error('[google/sheets/config GET] fetch error:', error)
      return NextResponse.json(
        { error: 'Failed to load Google Sheets connection' },
        { status: 500 },
      )
    }

    const row = data as GoogleSheetsConfigRow | null
    if (!row) {
      return NextResponse.json(toPublicConnection(null))
    }

    if (row.status === 'needs_reconnect') {
      return NextResponse.json(toPublicConnection(row))
    }

    if (!tokenNeedsRefresh(row.token_expires_at)) {
      return NextResponse.json(toPublicConnection(row))
    }

    try {
      const refreshToken = decryptGoogleToken(row.refresh_token)
      const tokens = await refreshGoogleAccessToken(refreshToken)
      const admin = supabaseAdmin()
      const { error: updateErr } = await admin
        .from('google_sheets_configs')
        .update({
          access_token: encryptGoogleToken(tokens.accessToken),
          refresh_token: encryptGoogleToken(tokens.refreshToken ?? refreshToken),
          token_expires_at: tokens.expiresAt,
          scopes: tokens.scopes.length ? tokens.scopes : row.scopes,
          status: 'connected',
        })
        .eq('account_id', accountId)

      if (updateErr) {
        console.error('[google/sheets/config GET] refresh save failed:', updateErr)
      }

      return NextResponse.json(
        toPublicConnection({ ...row, status: 'connected' }),
      )
    } catch (err) {
      const invalid =
        err instanceof GoogleOAuthError && err.code === 'invalid_grant'
      if (invalid) {
        const admin = supabaseAdmin()
        await admin
          .from('google_sheets_configs')
          .update({ status: 'needs_reconnect' })
          .eq('account_id', accountId)
        return NextResponse.json(
          toPublicConnection({ ...row, status: 'needs_reconnect' }),
        )
      }
      console.error('[google/sheets/config GET] refresh failed:', err)
      return NextResponse.json(toPublicConnection(row))
    }
  } catch (err) {
    return toErrorResponse(err)
  }
}

/**
 * DELETE /api/google/sheets/config  (admin+)
 *
 * Revoke the Google token (best-effort) and delete the row.
 */
export async function DELETE() {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(
      `google-sheets-disconnect:${userId}`,
      RATE_LIMITS.adminAction,
    )
    if (!limit.success) return rateLimitResponse(limit)

    const { data } = await supabase
      .from('google_sheets_configs')
      .select('access_token, refresh_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (data?.refresh_token || data?.access_token) {
      try {
        const token = decryptGoogleToken(
          data.refresh_token || data.access_token,
        )
        await revokeGoogleToken(token)
      } catch {
        // Already revoked or unreadable — still drop the row.
      }
    }

    const { error } = await supabase
      .from('google_sheets_configs')
      .delete()
      .eq('account_id', accountId)

    if (error) {
      console.error('[google/sheets/config DELETE] error:', error)
      return NextResponse.json(
        { error: 'Failed to disconnect Google Sheets' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}
