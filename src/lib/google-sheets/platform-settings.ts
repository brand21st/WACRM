import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export type GoogleCredentialsSource = 'database' | 'env' | 'none'

export interface PlatformGoogleRow {
  clientId: string | null
  clientSecret: string | null
}

export interface ResolvedGoogleOAuthCredentials {
  clientId: string
  clientSecret: string
  source: GoogleCredentialsSource
  configured: boolean
}

const CACHE_MS = 30_000
let cached: { at: number; value: PlatformGoogleRow | null } | null = null

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

function decryptOptional(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    return textOrNull(decrypt(value))
  } catch {
    console.error(
      '[platform google] client secret could not be decrypted — check ENCRYPTION_KEY.',
    )
    return null
  }
}

export function envGoogleClientId(): string {
  return (process.env.GOOGLE_SHEETS_CLIENT_ID ?? '').trim()
}

export function envGoogleClientSecret(): string {
  return (process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? '').trim()
}

export function __resetPlatformGoogleSettingsCache() {
  cached = null
}

export function isGoogleClientId(value: string): boolean {
  return /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i.test(value.trim())
}

export async function loadPlatformGoogleSettings(): Promise<PlatformGoogleRow | null> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value

  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_google_settings')
      .select('google_client_id, google_client_secret')
      .eq('id', 1)
      .maybeSingle()

    if (error || !data) {
      if (error) console.error('[platform google] failed to load settings:', error)
      cached = { at: now, value: null }
      return null
    }

    const value: PlatformGoogleRow = {
      clientId: textOrNull(data.google_client_id),
      clientSecret: decryptOptional(data.google_client_secret),
    }
    cached = { at: now, value }
    return value
  } catch (err) {
    console.error('[platform google] failed to load settings:', err)
    cached = { at: now, value: null }
    return null
  }
}

export async function resolveGoogleOAuthCredentials(): Promise<ResolvedGoogleOAuthCredentials> {
  const stored = await loadPlatformGoogleSettings()
  const dbId = stored?.clientId ?? ''
  const dbSecret = stored?.clientSecret ?? ''
  const envId = envGoogleClientId()
  const envSecret = envGoogleClientSecret()

  const useDatabase = Boolean(dbId && dbSecret)
  const clientId = useDatabase ? dbId : envId
  const clientSecret = useDatabase ? dbSecret : envSecret
  const configured = Boolean(clientId && clientSecret)

  return {
    clientId,
    clientSecret,
    source: useDatabase ? 'database' : configured ? 'env' : 'none',
    configured,
  }
}
