import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { IntegrationConnection } from '@/lib/integrations/types'

export const GOOGLE_SHEETS_CONFIG_COLUMNS =
  'id, google_email, google_account_id, access_token, refresh_token, token_expires_at, scopes, spreadsheet_name, last_synced_at, status'

export interface GoogleSheetsConfigRow {
  id: string
  google_email: string | null
  google_account_id: string | null
  access_token: string
  refresh_token: string
  token_expires_at: string | null
  scopes: string[] | null
  spreadsheet_name: string | null
  last_synced_at: string | null
  status: 'connected' | 'needs_reconnect'
}

export function supabaseAdmin(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export function toPublicConnection(
  row: Pick<
    GoogleSheetsConfigRow,
    'google_email' | 'spreadsheet_name' | 'last_synced_at' | 'status'
  > | null,
): IntegrationConnection {
  if (!row) {
    return { connected: false, status: 'not_connected' }
  }
  const status = row.status === 'needs_reconnect' ? 'needs_reconnect' : 'connected'
  return {
    connected: status === 'connected',
    status,
    accountLabel: row.google_email,
    detailLabel: row.spreadsheet_name,
    lastSyncedAt: row.last_synced_at,
  }
}

export function tokenNeedsRefresh(expiresAt: string | null): boolean {
  if (!expiresAt) return true
  const ms = Date.parse(expiresAt)
  if (Number.isNaN(ms)) return true
  return ms - Date.now() < 60_000
}

export function appOrigin(request: Request): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return new URL(request.url).origin
}
