import { createClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'

const CACHE_TTL_MS = 60_000

let cache: { secrets: string[]; loadedAt: number } | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}

/**
 * All App Secrets that may sign inbound Meta webhooks for this instance:
 * the platform default (META_APP_SECRET) plus any per-tenant secrets
 * saved on whatsapp_config for bring-your-own-app clients.
 */
export async function getWebhookAppSecrets(): Promise<string[]> {
  const now = Date.now()
  if (cache && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.secrets
  }

  const secrets = new Set<string>()
  const envSecret = process.env.META_APP_SECRET
  if (envSecret) secrets.add(envSecret)

  try {
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('meta_app_secret')
      .not('meta_app_secret', 'is', null)

    if (error) {
      console.warn('[webhook] failed to load per-tenant app secrets:', error.message)
    } else {
      for (const row of data ?? []) {
        if (!row.meta_app_secret) continue
        try {
          const decrypted = decrypt(row.meta_app_secret)
          if (decrypted) secrets.add(decrypted)
        } catch {
          // Wrong-key or legacy row — skip so other tenants still verify.
        }
      }
    }

    const { data: pageRows, error: pageErr } = await supabaseAdmin()
      .from('meta_page_connections')
      .select('meta_app_secret')
      .not('meta_app_secret', 'is', null)
    if (pageErr) {
      console.warn('[webhook] failed to load page app secrets:', pageErr.message)
    } else {
      for (const row of pageRows ?? []) {
        if (!row.meta_app_secret) continue
        try {
          const decrypted = decrypt(row.meta_app_secret)
          if (decrypted) secrets.add(decrypted)
        } catch {
          // skip bad tenant secrets
        }
      }
    }
  } catch (err) {
    console.warn('[webhook] app-secret lookup failed:', err)
  }

  const list = [...secrets]
  cache = { secrets: list, loadedAt: now }
  return list
}

export function invalidateWebhookAppSecretsCache(): void {
  cache = null
}
