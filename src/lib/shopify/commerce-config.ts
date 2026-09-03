import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { isMissingDbColumn } from './config-db'
import { parseRetailerIdSource, type RetailerIdSource } from './retailer-id'
import type { CommerceBeneficiary, CommerceSecrets, CommerceSettings } from '@/lib/commerce/types'
import { isCompleteBeneficiary } from '@/lib/commerce/order-details'

export const COMMERCE_SELECT =
  'meta_catalog_id, retailer_id_source, meta_catalog_auto_sync, last_meta_catalog_sync_at, meta_catalog_item_count, wa_payment_configuration_name, razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret, ship_beneficiary'

export function emptyCommerceSettings(): CommerceSettings {
  return {
    metaCatalogId: null,
    metaCatalogAutoSync: false,
    lastMetaCatalogSyncAt: null,
    metaCatalogItemCount: 0,
    retailerIdSource: 'sku',
    waPaymentConfigurationName: null,
    razorpayKeyId: null,
    hasRazorpaySecret: false,
    hasRazorpayWebhookSecret: false,
    shipBeneficiary: null,
  }
}

export async function loadCommerceSettings(
  db: SupabaseClient,
  accountId: string,
): Promise<CommerceSettings> {
  const { data, error } = await db
    .from('shopify_configs')
    .select(COMMERCE_SELECT)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error && isMissingDbColumn(error, 'wa_payment_configuration_name')) {
    return emptyCommerceSettings()
  }
  if (error) throw error
  if (!data) return emptyCommerceSettings()
  return settingsFromRow(data as Record<string, unknown>)
}

export async function loadCommerceSecrets(
  db: SupabaseClient,
  accountId: string,
): Promise<CommerceSecrets> {
  const { data, error } = await db
    .from('shopify_configs')
    .select('razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data) {
    return {
      razorpayKeyId: null,
      razorpayKeySecret: null,
      razorpayWebhookSecret: null,
    }
  }
  const row = data as Record<string, unknown>
  return {
    razorpayKeyId: textOrNull(row.razorpay_key_id),
    razorpayKeySecret: decryptOptional(row.razorpay_key_secret),
    razorpayWebhookSecret: decryptOptional(row.razorpay_webhook_secret),
  }
}

export function settingsFromRow(row: Record<string, unknown>): CommerceSettings {
  return {
    metaCatalogId: textOrNull(row.meta_catalog_id),
    metaCatalogAutoSync: row.meta_catalog_auto_sync === true,
    lastMetaCatalogSyncAt:
      typeof row.last_meta_catalog_sync_at === 'string'
        ? row.last_meta_catalog_sync_at
        : null,
    metaCatalogItemCount: Number(row.meta_catalog_item_count ?? 0) || 0,
    retailerIdSource: parseRetailerIdSource(row.retailer_id_source),
    waPaymentConfigurationName: textOrNull(row.wa_payment_configuration_name),
    razorpayKeyId: textOrNull(row.razorpay_key_id),
    hasRazorpaySecret: Boolean(textOrNull(row.razorpay_key_secret)),
    hasRazorpayWebhookSecret: Boolean(textOrNull(row.razorpay_webhook_secret)),
    shipBeneficiary: parseBeneficiary(row.ship_beneficiary),
  }
}

export function publicCommercePayload(settings: CommerceSettings) {
  return {
    meta_catalog_id: settings.metaCatalogId,
    meta_catalog_auto_sync: settings.metaCatalogAutoSync,
    last_meta_catalog_sync_at: settings.lastMetaCatalogSyncAt,
    meta_catalog_item_count: settings.metaCatalogItemCount,
    retailer_id_source: settings.retailerIdSource,
    wa_payment_configuration_name: settings.waPaymentConfigurationName,
    razorpay_key_id: settings.razorpayKeyId,
    has_razorpay_secret: settings.hasRazorpaySecret,
    has_razorpay_webhook_secret: settings.hasRazorpayWebhookSecret,
    ship_beneficiary: settings.shipBeneficiary,
  }
}

export function encryptSecret(raw: string): string {
  return encrypt(raw)
}

export interface CommerceSettingsPatch {
  metaCatalogId?: string | null
  metaCatalogAutoSync?: boolean
  retailerIdSource?: RetailerIdSource
  waPaymentConfigurationName?: string | null
  razorpayKeyId?: string | null
  razorpayKeySecret?: string | null
  clearRazorpaySecret?: boolean
  razorpayWebhookSecret?: string | null
  clearRazorpayWebhookSecret?: boolean
  shipBeneficiary?: CommerceBeneficiary | null
}

export async function saveCommerceSettings(
  db: SupabaseClient,
  accountId: string,
  patch: CommerceSettingsPatch,
): Promise<void> {
  const update: Record<string, unknown> = {}
  if ('metaCatalogId' in patch) {
    update.meta_catalog_id = textOrNull(patch.metaCatalogId)
  }
  if ('metaCatalogAutoSync' in patch) {
    update.meta_catalog_auto_sync = patch.metaCatalogAutoSync === true
  }
  if ('retailerIdSource' in patch && patch.retailerIdSource) {
    update.retailer_id_source = parseRetailerIdSource(patch.retailerIdSource)
  }
  if ('waPaymentConfigurationName' in patch) {
    const name = textOrNull(patch.waPaymentConfigurationName)
    if (name && name.length > 60) {
      throw new Error('Payment configuration name must be 60 characters or fewer')
    }
    update.wa_payment_configuration_name = name
  }
  if ('razorpayKeyId' in patch) {
    update.razorpay_key_id = textOrNull(patch.razorpayKeyId)
  }
  if (patch.clearRazorpaySecret) {
    update.razorpay_key_secret = null
  } else if (patch.razorpayKeySecret?.trim()) {
    update.razorpay_key_secret = encrypt(patch.razorpayKeySecret.trim())
  }
  if (patch.clearRazorpayWebhookSecret) {
    update.razorpay_webhook_secret = null
  } else if (patch.razorpayWebhookSecret?.trim()) {
    update.razorpay_webhook_secret = encrypt(patch.razorpayWebhookSecret.trim())
  }
  if ('shipBeneficiary' in patch) {
    update.ship_beneficiary = patch.shipBeneficiary
      ? parseBeneficiary(patch.shipBeneficiary)
      : null
  }
  if (Object.keys(update).length === 0) return
  const { error } = await db
    .from('shopify_configs')
    .update(update)
    .eq('account_id', accountId)
  if (error) throw error
}

export function parseBeneficiary(raw: unknown): CommerceBeneficiary | null {
  if (!isCompleteBeneficiary(raw)) return null
  return raw
}

function textOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t || null
}

function decryptOptional(raw: unknown): string | null {
  const t = textOrNull(raw)
  if (!t) return null
  try {
    return decrypt(t)
  } catch {
    return null
  }
}

export function asRetailerIdSource(raw: unknown): RetailerIdSource {
  return parseRetailerIdSource(raw)
}
