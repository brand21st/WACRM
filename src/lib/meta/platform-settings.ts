import { supabaseAdmin } from '@/lib/ai/admin-client'
import { decrypt } from '@/lib/whatsapp/encryption'

export type FacebookLoginSource = 'database' | 'env' | 'none'

export interface PlatformMetaRow {
  appId: string | null
  configId: string | null
  appSecret: string | null
}

export interface ResolvedFacebookLoginConfig {
  appId: string
  configId: string
  appSecret: string
  source: FacebookLoginSource
  enabled: boolean
  configured: boolean
}

const CACHE_MS = 30_000
let cached: { at: number; value: PlatformMetaRow | null } | null = null

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
      '[platform meta] Facebook app secret could not be decrypted — check ENCRYPTION_KEY.',
    )
    return null
  }
}

export function envFacebookAppId(): string {
  return (process.env.META_APP_ID ?? '').trim()
}

export function envFacebookLoginConfigId(): string {
  return (process.env.META_FACEBOOK_LOGIN_CONFIG_ID ?? '').trim()
}

export function envFacebookAppSecret(): string {
  return (process.env.META_APP_SECRET ?? '').trim()
}

export function __resetPlatformMetaSettingsCache() {
  cached = null
}

export function isFacebookAppId(value: string): boolean {
  return /^\d{5,32}$/.test(value.trim())
}

export function isFacebookLoginConfigId(value: string): boolean {
  return /^[\w-]{4,128}$/.test(value.trim())
}

export async function loadPlatformMetaSettings(): Promise<PlatformMetaRow | null> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value

  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_meta_settings')
      .select('facebook_app_id, facebook_login_config_id, facebook_app_secret')
      .eq('id', 1)
      .maybeSingle()

    if (error || !data) {
      if (error) console.error('[platform meta] failed to load settings:', error)
      cached = { at: now, value: null }
      return null
    }

    const value: PlatformMetaRow = {
      appId: textOrNull(data.facebook_app_id),
      configId: textOrNull(data.facebook_login_config_id),
      appSecret: decryptOptional(data.facebook_app_secret),
    }
    cached = { at: now, value }
    return value
  } catch (err) {
    console.error('[platform meta] failed to load settings:', err)
    cached = { at: now, value: null }
    return null
  }
}

export async function resolveFacebookLoginConfig(): Promise<ResolvedFacebookLoginConfig> {
  const stored = await loadPlatformMetaSettings()
  const dbAppId = stored?.appId ?? ''
  const dbConfigId = stored?.configId ?? ''
  const dbSecret = stored?.appSecret ?? ''
  const envAppId = envFacebookAppId()
  const envConfigId = envFacebookLoginConfigId()
  const envSecret = envFacebookAppSecret()

  const appId = dbAppId || envAppId
  const configId = dbConfigId || envConfigId
  const appSecret = dbSecret || envSecret
  const fromDatabase = Boolean(dbAppId || dbConfigId || dbSecret)
  const enabled = Boolean(appId)

  return {
    appId,
    configId,
    appSecret,
    source: fromDatabase ? 'database' : enabled ? 'env' : 'none',
    enabled,
    configured: enabled,
  }
}
