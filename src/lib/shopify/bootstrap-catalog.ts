import type { SupabaseClient } from '@supabase/supabase-js'

import { loadShopifyConfig } from './config'
import { syncCatalog } from './catalog'
import { syncStoreContent } from './store-content'
import { registerCatalogWebhooks } from './register-webhooks'

/**
 * Catalog + store-content pull plus webhook registration — run after
 * connect/install.
 */
export async function bootstrapShopify(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  if (!config) return

  try {
    await registerCatalogWebhooks(config)
  } catch (err) {
    console.error('[shopify/bootstrap] webhook registration failed:', err)
  }

  try {
    await syncCatalog(db, config)
  } catch (err) {
    console.error('[shopify/bootstrap] catalog sync failed:', err)
  }

  try {
    await syncStoreContent(db, config)
  } catch (err) {
    console.error('[shopify/bootstrap] store content sync failed:', err)
  }
}

/** @deprecated Use bootstrapShopify — kept so existing call sites keep working. */
export async function bootstrapShopifyCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<void> {
  return bootstrapShopify(db, accountId)
}
