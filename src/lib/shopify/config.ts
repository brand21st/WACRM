import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { resolveAdminAccessToken } from './oauth'
import { isMissingClientIdColumn } from './config-db'
import {
  resolveStoredClientId,
  unpackShopifyCredential,
} from './credential-storage'
import type { ShopifyStoreConfig } from './types'

interface ShopifyConfigRow {
  shop_domain: string
  access_token: string
  is_active: boolean
  shop_name: string | null
  primary_domain: string | null
  currency: string | null
  client_id: string | null
  meta_catalog_id: string | null
  last_verified_at: string | null
  last_catalog_sync_at: string | null
  catalog_product_count: number | null
}

const COLUMNS =
  'shop_domain, access_token, is_active, shop_name, primary_domain, currency, client_id, meta_catalog_id, last_verified_at, last_catalog_sync_at, catalog_product_count'

const LEGACY_COLUMNS =
  'shop_domain, access_token, is_active, shop_name, primary_domain, currency, meta_catalog_id, last_verified_at, last_catalog_sync_at, catalog_product_count'

/**
 * Load and decrypt the account's Shopify config. Returns null when
 * missing or inactive (unless `requireActive` is false). Throws if the
 * token cannot be decrypted.
 *
 * When the stored credential is a Partner API secret (shpss_), exchanges
 * it with the stored Client ID for a short-lived Admin API token.
 */
export async function loadShopifyConfig(
  db: SupabaseClient,
  accountId: string,
  opts: { requireActive?: boolean } = {},
): Promise<ShopifyStoreConfig | null> {
  const { requireActive = true } = opts
  let { data, error } = await db
    .from('shopify_configs')
    .select(COLUMNS)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error && isMissingClientIdColumn(error)) {
    ;({ data, error } = await db
      .from('shopify_configs')
      .select(LEGACY_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle())
  }

  if (error) throw error
  if (!data) return null
  const row = data as ShopifyConfigRow
  if (requireActive && !row.is_active) return null
  if (!row.access_token) return null

  const decrypted = decrypt(row.access_token)
  const unpacked = unpackShopifyCredential(decrypted)
  const accessToken = await resolveAdminAccessToken({
    shopDomain: row.shop_domain,
    clientId: resolveStoredClientId(row.client_id, unpacked.clientId),
    credential: unpacked.credential,
  })

  return {
    accountId,
    shopDomain: row.shop_domain,
    accessToken,
    isActive: row.is_active,
    shopName: row.shop_name,
    primaryDomain: row.primary_domain,
    currency: row.currency,
    metaCatalogId: row.meta_catalog_id,
    lastVerifiedAt: row.last_verified_at,
    lastCatalogSyncAt: row.last_catalog_sync_at,
    catalogProductCount: row.catalog_product_count ?? 0,
  }
}

export function catalogIsFresh(config: ShopifyStoreConfig): boolean {
  if (!config.lastCatalogSyncAt || config.catalogProductCount <= 0) return false
  const synced = Date.parse(config.lastCatalogSyncAt)
  if (!Number.isFinite(synced)) return false
  return Date.now() - synced < 24 * 60 * 60 * 1000
}
