import type { SupabaseClient } from '@supabase/supabase-js'
import type { ShopifyCatalogVariant } from '@/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { loadCommerceSettings } from './commerce-config'
import { loadShopifyConfig } from './config'
import { MAX_CATALOG_PRODUCTS } from './catalog'
import {
  parseRetailerIdSource,
  retailerIdForVariant,
  type RetailerIdSource,
} from './retailer-id'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

export interface MetaCatalogItem {
  retailer_id: string
  name: string
  description?: string
  availability: 'in stock' | 'out of stock'
  condition: 'new'
  price: number
  currency: string
  url: string
  image_url?: string
  brand?: string
}

export function catalogItemsFromProduct(
  product: Pick<
    ShopifyProductHit,
    'id' | 'title' | 'description' | 'imageUrl' | 'productUrl' | 'currency' | 'variants'
  >,
  source: RetailerIdSource,
  brand?: string | null,
): MetaCatalogItem[] {
  const currency = (product.currency || 'INR').toUpperCase()
  const items: MetaCatalogItem[] = []
  const seen = new Set<string>()
  for (const variant of product.variants) {
    const retailerId = retailerIdForVariant(variant, source, product.id)
    if (!retailerId || seen.has(retailerId)) continue
    seen.add(retailerId)
    const price = Number(variant.price)
    items.push({
      retailer_id: retailerId,
      name: variant.title && variant.title !== 'Default'
        ? `${product.title} — ${variant.title}`.slice(0, 200)
        : product.title.slice(0, 200),
      description: (product.description || product.title).slice(0, 9999),
      availability: variant.available ? 'in stock' : 'out of stock',
      condition: 'new',
      price: Number.isFinite(price) ? price : 0,
      currency,
      url: product.productUrl,
      image_url: product.imageUrl || undefined,
      brand: brand?.trim() || undefined,
    })
  }
  return items
}

export async function loadWhatsAppAccessToken(
  db: SupabaseClient,
  accountId: string,
): Promise<{ token: string; phoneNumberId: string; wabaId: string } | null> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('access_token, phone_number_id, waba_id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error || !data?.access_token) return null
  try {
    return {
      token: decrypt(data.access_token as string),
      phoneNumberId: String(data.phone_number_id ?? ''),
      wabaId: String(data.waba_id ?? ''),
    }
  } catch {
    return null
  }
}

export function catalogIdLooksLikeWhatsAppAsset(
  catalogId: string,
  phoneNumberId: string,
  wabaId: string,
): string | null {
  if (phoneNumberId && catalogId === phoneNumberId) {
    return 'That value is your WhatsApp Phone Number ID, not a Commerce catalog ID. Copy Catalog ID from Commerce Manager → Catalogs → [catalog] → Catalog ID.'
  }
  if (wabaId && catalogId === wabaId) {
    return 'That value is your WhatsApp Business Account ID, not a Commerce catalog ID. Copy Catalog ID from Commerce Manager → Catalogs → [catalog] → Catalog ID.'
  }
  return null
}

export function explainMetaCatalogSyncError(opts: {
  catalogId: string
  graphMessage: string
  phoneNumberId: string
  wabaId: string
  connected: { id: string; name?: string }[]
}): string {
  const swapped = catalogIdLooksLikeWhatsAppAsset(
    opts.catalogId,
    opts.phoneNumberId,
    opts.wabaId,
  )
  if (swapped) return swapped

  const connectedHint =
    opts.connected.length > 0
      ? ` Catalog connected to this WhatsApp account: ${opts.connected
          .map((c) => (c.name ? `${c.id} (${c.name})` : c.id))
          .join(', ')}.`
      : ' No product catalog is connected to this WhatsApp Business Account yet — connect one in WhatsApp Manager → Catalog.'

  if (
    /does not exist|missing permissions|does not support this operation|Unsupported post request/i.test(
      opts.graphMessage,
    )
  ) {
    return (
      `Meta could not use catalog ${opts.catalogId} with this WhatsApp token. Paste the Catalog ID from Commerce Manager (Business settings → Commerce Manager → Catalogs), not a Page, App, Phone Number, or WABA ID. The catalog must be connected to this WABA, and the Meta app needs catalog_management.` +
      connectedHint
    )
  }
  return `${opts.graphMessage}${connectedHint}`
}

export async function listWabaProductCatalogs(
  wabaId: string,
  accessToken: string,
): Promise<{ id: string; name?: string }[]> {
  const id = wabaId.trim()
  if (!id) return []
  const url = `${META_API_BASE}/${encodeURIComponent(id)}/product_catalogs?fields=id,name`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return []
  const body = (await res.json().catch(() => null)) as {
    data?: { id?: string; name?: string }[]
  } | null
  return (body?.data ?? [])
    .map((row) => ({
      id: String(row.id ?? '').trim(),
      name: row.name?.trim() || undefined,
    }))
    .filter((row) => row.id)
}

export async function syncMetaCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<{ count: number }> {
  const settings = await loadCommerceSettings(db, accountId)
  const catalogId = settings.metaCatalogId?.trim()
  if (!catalogId) throw new Error('Set a WhatsApp catalog ID first')

  const wa = await loadWhatsAppAccessToken(db, accountId)
  if (!wa) throw new Error('Connect WhatsApp before syncing the Meta catalog')

  const swapped = catalogIdLooksLikeWhatsAppAsset(
    catalogId,
    wa.phoneNumberId,
    wa.wabaId,
  )
  if (swapped) throw new Error(swapped)

  const config = await loadShopifyConfig(db, accountId, { requireActive: false })
  if (!config) throw new Error('Connect Shopify first')

  const { data, error } = await db
    .from('shopify_catalog_products')
    .select(
      'shopify_product_id, handle, title, body, body_excerpt, currency, variant_summary, image_url, product_url',
    )
    .eq('account_id', accountId)
    .limit(MAX_CATALOG_PRODUCTS)
  if (error) throw error

  const source = settings.retailerIdSource
  const items: MetaCatalogItem[] = []
  for (const row of data ?? []) {
    const variants = Array.isArray(row.variant_summary)
      ? (row.variant_summary as ShopifyCatalogVariant[])
      : []
    const mapped = catalogItemsFromProduct(
      {
        id: String(row.shopify_product_id),
        title: String(row.title),
        description: String(row.body || row.body_excerpt || ''),
        imageUrl: row.image_url as string | null,
        productUrl: String(row.product_url || ''),
        currency: (row.currency as string | null) || config.currency,
        variants: variants.map((v) => ({
          id: v.id,
          variantId: v.variantId,
          title: v.title,
          sku: v.sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          available: v.available,
          options: v.options,
        })),
      },
      source,
      config.shopName,
    )
    items.push(...mapped)
  }

  try {
    await upsertMetaCatalogItems(catalogId, wa.token, items)
  } catch (err) {
    const connected = await listWabaProductCatalogs(wa.wabaId, wa.token)
    throw new Error(
      explainMetaCatalogSyncError({
        catalogId,
        graphMessage: err instanceof Error ? err.message : String(err),
        phoneNumberId: wa.phoneNumberId,
        wabaId: wa.wabaId,
        connected,
      }),
    )
  }
  await db
    .from('shopify_configs')
    .update({
      last_meta_catalog_sync_at: new Date().toISOString(),
      meta_catalog_item_count: items.length,
    })
    .eq('account_id', accountId)

  return { count: items.length }
}

export async function pushProductToMetaCatalog(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  product: ShopifyProductHit,
): Promise<void> {
  const settings = await loadCommerceSettings(db, config.accountId)
  if (!settings.metaCatalogAutoSync || !settings.metaCatalogId) return
  const wa = await loadWhatsAppAccessToken(db, config.accountId)
  if (!wa) return
  const items = catalogItemsFromProduct(
    product,
    parseRetailerIdSource(settings.retailerIdSource),
    config.shopName,
  )
  if (items.length === 0) return
  try {
    await upsertMetaCatalogItems(settings.metaCatalogId, wa.token, items)
  } catch (err) {
    console.warn('[shopify meta-catalog] upsert failed:', err)
  }
}

export async function deleteProductFromMetaCatalog(
  db: SupabaseClient,
  accountId: string,
  retailerIds: string[],
): Promise<void> {
  const settings = await loadCommerceSettings(db, accountId)
  if (!settings.metaCatalogAutoSync || !settings.metaCatalogId) return
  const wa = await loadWhatsAppAccessToken(db, accountId)
  if (!wa) return
  const ids = retailerIds.map((id) => id.trim()).filter(Boolean)
  if (ids.length === 0) return
  try {
    await deleteMetaCatalogItems(settings.metaCatalogId, wa.token, ids)
  } catch (err) {
    console.warn('[shopify meta-catalog] delete failed:', err)
  }
}

export async function upsertMetaCatalogItems(
  catalogId: string,
  accessToken: string,
  items: MetaCatalogItem[],
): Promise<void> {
  const chunkSize = 50
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize)
    const requests = chunk.map((item) => ({
      method: 'UPDATE',
      data: {
        id: item.retailer_id,
        title: item.name,
        description: item.description,
        availability: item.availability,
        condition: item.condition,
        price: formatCatalogPrice(item.price, item.currency),
        link: item.url,
        image_link: item.image_url,
        brand: item.brand,
      },
    }))
    await catalogBatch(catalogId, accessToken, requests)
  }
}

export async function deleteMetaCatalogItems(
  catalogId: string,
  accessToken: string,
  retailerIds: string[],
): Promise<void> {
  const requests = retailerIds.map((id) => ({
    method: 'DELETE',
    data: { id },
  }))
  await catalogBatch(catalogId, accessToken, requests)
}

function formatCatalogPrice(major: number, currency: string): string {
  return `${Number(major).toFixed(2)} ${currency}`
}

async function catalogBatch(
  catalogId: string,
  accessToken: string,
  requests: Record<string, unknown>[],
): Promise<void> {
  if (requests.length === 0) return
  const url = `${META_API_BASE}/${encodeURIComponent(catalogId)}/items_batch`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item_type: 'PRODUCT_ITEM',
      allow_upsert: true,
      requests: JSON.stringify(requests),
    }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(
      body?.error?.message || `Meta catalog sync failed (${res.status})`,
    )
  }
}
