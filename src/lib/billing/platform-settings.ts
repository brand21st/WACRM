import { decrypt } from '@/lib/whatsapp/encryption'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export type BillingCredentialsSource = 'database' | 'env' | 'none'

export interface PlatformBillingRow {
  razorpayKeyId: string | null
  razorpayKeySecret: string | null
  razorpayWebhookSecret: string | null
}

export interface ResolvedBillingCredentials {
  keyId: string
  keySecret: string
  webhookSecret: string
  source: BillingCredentialsSource
  configured: boolean
}

const CACHE_MS = 30_000
let cached: { at: number; value: PlatformBillingRow | null } | null = null

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

function decryptOptional(value: string | null | undefined, label: string): string | null {
  if (!value) return null
  try {
    return textOrNull(decrypt(value))
  } catch {
    console.error(
      `[platform billing] ${label} could not be decrypted — check ENCRYPTION_KEY.`,
    )
    return null
  }
}

export function envRazorpayKeyId(): string {
  return (process.env.RAZORPAY_KEY_ID ?? process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? '').trim()
}

export function envRazorpayKeySecret(): string {
  return (process.env.RAZORPAY_KEY_SECRET ?? '').trim()
}

export function envRazorpayWebhookSecret(): string {
  return (process.env.RAZORPAY_WEBHOOK_SECRET ?? '').trim()
}

export function __resetPlatformBillingSettingsCache() {
  cached = null
}

export async function loadPlatformBillingSettings(): Promise<PlatformBillingRow | null> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) return cached.value

  try {
    const { data, error } = await supabaseAdmin()
      .from('platform_billing_settings')
      .select('razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret')
      .eq('id', 1)
      .maybeSingle()

    if (error || !data) {
      if (error) console.error('[platform billing] failed to load settings:', error)
      cached = { at: now, value: null }
      return null
    }

    const value: PlatformBillingRow = {
      razorpayKeyId: textOrNull(data.razorpay_key_id),
      razorpayKeySecret: decryptOptional(data.razorpay_key_secret, 'Razorpay key secret'),
      razorpayWebhookSecret: decryptOptional(
        data.razorpay_webhook_secret,
        'Razorpay webhook secret',
      ),
    }
    cached = { at: now, value }
    return value
  } catch (err) {
    console.error('[platform billing] failed to load settings:', err)
    cached = { at: now, value: null }
    return null
  }
}

export async function resolveBillingCredentials(): Promise<ResolvedBillingCredentials> {
  const stored = await loadPlatformBillingSettings()
  const dbKeyId = stored?.razorpayKeyId ?? ''
  const dbSecret = stored?.razorpayKeySecret ?? ''
  const envKeyId = envRazorpayKeyId()
  const envSecret = envRazorpayKeySecret()

  const useDatabase = Boolean(dbKeyId && dbSecret)
  const keyId = useDatabase ? dbKeyId : envKeyId
  const keySecret = useDatabase ? dbSecret : envSecret
  const webhookSecret = stored?.razorpayWebhookSecret || envRazorpayWebhookSecret()
  const configured = Boolean(keyId && keySecret)

  return {
    keyId,
    keySecret,
    webhookSecret,
    source: useDatabase ? 'database' : configured ? 'env' : 'none',
    configured,
  }
}
