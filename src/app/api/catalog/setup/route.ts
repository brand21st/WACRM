import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  catalogSchemaMissingResponse,
  isCatalogSchemaError,
} from '@/lib/catalog/http'
import { isMissingDbColumn, isMissingDbRelation } from '@/lib/shopify/config-db'
import { normalizeMetaCatalogIds } from '@/lib/shopify/commerce-config'
import { listCollectionsByAccount, loadCatalogAnalyticsMode } from '@/lib/catalog'

/**
 * GET /api/catalog/setup  (agent+)
 *
 * Checklist payload for the Catalog setup strip.
 */
export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')

    const { count, error: countError } = await supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)

    if (countError) {
      if (isMissingDbRelation(countError, 'catalog_products')) {
        return catalogSchemaMissingResponse()
      }
      throw countError
    }

    let { data: shopify, error: shopifyError } = await supabase
      .from('shopify_configs')
      .select(
        'shop_domain, shop_name, access_token, last_catalog_sync_at, meta_catalog_id, meta_catalog_ids, meta_catalog_auto_sync, last_meta_catalog_sync_at, meta_catalog_item_count',
      )
      .eq('account_id', accountId)
      .maybeSingle()

    if (shopifyError && isMissingDbColumn(shopifyError, 'meta_catalog_ids')) {
      ;({ data: shopify, error: shopifyError } = await supabase
        .from('shopify_configs')
        .select(
          'shop_domain, shop_name, access_token, last_catalog_sync_at, meta_catalog_id, meta_catalog_auto_sync, last_meta_catalog_sync_at, meta_catalog_item_count',
        )
        .eq('account_id', accountId)
        .maybeSingle())
    }
    if (shopifyError) throw shopifyError

    const { data: whatsapp } = await supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    const shopDomain =
      typeof shopify?.shop_domain === 'string' ? shopify.shop_domain.trim() : ''
    const shopToken =
      typeof shopify?.access_token === 'string' ? shopify.access_token.trim() : ''
    const waPhone =
      typeof whatsapp?.phone_number_id === 'string'
        ? whatsapp.phone_number_id.trim()
        : ''
    const waToken =
      typeof whatsapp?.access_token === 'string'
        ? whatsapp.access_token.trim()
        : ''

    const collections = await listCollectionsByAccount(supabase, accountId).catch(() => [])
    const catalogAnalytics = (await loadCatalogAnalyticsMode(supabase, accountId)) === 'on'

    return NextResponse.json({
      schema_ready: true,
      shopify_connected: Boolean(shopDomain && shopToken),
      catalog_analytics: catalogAnalytics,
      collections,
      shopify_domain: shopDomain || null,
      shopify_name:
        typeof shopify?.shop_name === 'string' && shopify.shop_name.trim()
          ? shopify.shop_name.trim()
          : shopDomain || null,
      product_count: count ?? 0,
      last_import_at:
        typeof shopify?.last_catalog_sync_at === 'string'
          ? shopify.last_catalog_sync_at
          : null,
      meta_catalog_id:
        typeof shopify?.meta_catalog_id === 'string' && shopify.meta_catalog_id.trim()
          ? shopify.meta_catalog_id.trim()
          : null,
      meta_catalog_ids: (() => {
        const ids = normalizeMetaCatalogIds(
          (shopify as { meta_catalog_ids?: unknown } | null)?.meta_catalog_ids,
        )
        const primary =
          typeof shopify?.meta_catalog_id === 'string'
            ? shopify.meta_catalog_id.trim()
            : ''
        return ids.length > 0 ? ids : primary ? [primary] : []
      })(),
      meta_catalog_auto_sync: shopify?.meta_catalog_auto_sync === true,
      last_meta_sync_at:
        typeof shopify?.last_meta_catalog_sync_at === 'string'
          ? shopify.last_meta_catalog_sync_at
          : null,
      meta_item_count: Number(shopify?.meta_catalog_item_count ?? 0) || 0,
      whatsapp_connected: Boolean(waPhone && waToken),
    })
  } catch (err) {
    if (isCatalogSchemaError(err)) return catalogSchemaMissingResponse()
    return toErrorResponse(err)
  }
}
