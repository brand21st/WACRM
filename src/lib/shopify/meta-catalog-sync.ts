import type { SupabaseClient } from '@supabase/supabase-js'
import { decrypt } from '@/lib/whatsapp/encryption'
import { enqueueFullCatalogMetaSync } from '@/lib/catalog/sync/full-sync'
import { commerceMetaCatalogIds, loadCommerceSettings } from './commerce-config'
import { retailerIdForVariant, type RetailerIdSource } from './retailer-id'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'

export class MetaCatalogGraphError extends Error {
  readonly status: number
  readonly retryAfterMs: number | null

  constructor(
    message: string,
    status: number,
    retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'MetaCatalogGraphError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

export class CatalogSetSyncWaitError extends Error {
  constructor(message = 'Waiting for product catalog sync') {
    super(message)
    this.name = 'CatalogSetSyncWaitError'
  }
}

export function isRetryableMetaCatalogError(err: unknown): boolean {
  if (err instanceof CatalogSetSyncWaitError) return true
  if (err instanceof MetaCatalogGraphError) {
    return err.status === 0 || err.status === 429 || err.status >= 500
  }
  const message = err instanceof Error ? err.message : String(err)
  return /timeout|timed out|network|ECONNRESET|EAI_AGAIN|fetch failed|waiting for product catalog sync/i.test(
    message,
  )
}

export function isMetaItemNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  if (/unsupported post request|object with id '/i.test(message)) return false
  return /retailer[_ ]id|product item|item does not exist|item not found/i.test(
    message,
  )
}

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

/**
 * Result of asking Meta which catalogs a WABA has. `unavailable` is a
 * distinct state on purpose: a token that can't read the catalog edges
 * proves nothing about whether a catalog is connected, and conflating
 * the two made the sync error tell users to connect a catalog they
 * already had.
 */
export type WabaCatalogLookup =
  | { status: 'ok'; catalogs: { id: string; name?: string }[] }
  | { status: 'unavailable'; reason: string }

/**
 * Graph's reply when the app or token lacks `catalog_management`. It
 * comes back on every catalog edge — including the read we use to list a
 * WABA's catalogs — so it has to be recognised before any conclusion is
 * drawn from an empty catalog list.
 */
function looksLikeMissingCatalogScope(message: string): boolean {
  // Matched narrowly: Graph's unrelated object-not-found reply also says
  // "cannot be loaded due to missing permissions", so only the bare
  // "Missing Permission" (which always ends the message) counts here.
  return (
    /has not been approved to use this api|application capabilities|access token permissions/i.test(
      message,
    ) || /missing permission\.?\s*$/i.test(message)
  )
}

export function explainMetaCatalogSyncError(opts: {
  catalogId: string
  graphMessage: string
  phoneNumberId: string
  wabaId: string
  connected: WabaCatalogLookup
}): string {
  const swapped = catalogIdLooksLikeWhatsAppAsset(
    opts.catalogId,
    opts.phoneNumberId,
    opts.wabaId,
  )
  if (swapped) return swapped

  const probeBlocked =
    opts.connected.status === 'unavailable' &&
    looksLikeMissingCatalogScope(opts.connected.reason)
  if (looksLikeMissingCatalogScope(opts.graphMessage) || probeBlocked) {
    return `This WhatsApp access token cannot use catalogs — Meta replied "${opts.graphMessage}". The token needs the catalog_management permission, which WhatsApp-only tokens do not include. In Meta Business Settings → Users → System users, give the system user access to the catalog, generate a new token with catalog_management (plus whatsapp_business_management and whatsapp_business_messaging), then paste it into Settings → WhatsApp. Catalog ${opts.catalogId} itself does not need to change.`
  }

  const connectedHint =
    opts.connected.status === 'unavailable'
      ? ` Could not check which catalogs are connected to this WhatsApp Business Account: ${opts.connected.reason}`
      : opts.connected.catalogs.length > 0
        ? ` Catalog connected to this WhatsApp account: ${opts.connected.catalogs
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
): Promise<WabaCatalogLookup> {
  const id = wabaId.trim()
  if (!id) {
    return {
      status: 'unavailable',
      reason: 'no WhatsApp Business Account ID is saved for this account.',
    }
  }
  const url = `${META_API_BASE}/${encodeURIComponent(id)}/product_catalogs?fields=id,name`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
  const body = (await res.json().catch(() => null)) as {
    data?: { id?: string; name?: string }[]
    error?: { message?: string }
  } | null
  if (!res.ok) {
    return {
      status: 'unavailable',
      reason: body?.error?.message || `Graph returned ${res.status}.`,
    }
  }
  return {
    status: 'ok',
    catalogs: (body?.data ?? [])
      .map((row) => ({
        id: String(row.id ?? '').trim(),
        name: row.name?.trim() || undefined,
      }))
      .filter((row) => row.id),
  }
}

/**
 * Manual Meta resync. Enqueues WACRM catalog products; does not call Graph.
 * `count` is the number of queued products, not Graph items.
 */
export async function syncMetaCatalog(
  db: SupabaseClient,
  accountId: string,
): Promise<{ count: number }> {
  const settings = await loadCommerceSettings(db, accountId)
  const catalogIds = commerceMetaCatalogIds(settings)
  if (catalogIds.length === 0) throw new Error('Set a WhatsApp catalog ID first')

  const wa = await loadWhatsAppAccessToken(db, accountId)
  if (!wa) throw new Error('Connect WhatsApp before syncing the Meta catalog')

  for (const catalogId of catalogIds) {
    const swapped = catalogIdLooksLikeWhatsAppAsset(
      catalogId,
      wa.phoneNumberId,
      wa.wabaId,
    )
    if (swapped) throw new Error(swapped)
  }

  const result = await enqueueFullCatalogMetaSync(db, accountId)
  return { count: result.queued }
}

let deprecatedShopifyMetaWriteWarned = false

function warnDeprecatedShopifyMetaWrite(): void {
  if (deprecatedShopifyMetaWriteWarned) return
  deprecatedShopifyMetaWriteWarned = true
  console.warn(
    '[shopify meta-catalog] Shopify no longer writes Meta; use catalog-meta-sync',
  )
}

/** @deprecated Meta writes go through catalog_sync_outbox + catalog-meta-sync. */
export async function pushProductToMetaCatalog(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  product: ShopifyProductHit,
): Promise<void> {
  void db
  void config
  void product
  warnDeprecatedShopifyMetaWrite()
}

/** @deprecated Meta writes go through catalog_sync_outbox + catalog-meta-sync. */
export async function deleteProductFromMetaCatalog(
  db: SupabaseClient,
  accountId: string,
  retailerIds: string[],
): Promise<void> {
  void db
  void accountId
  void retailerIds
  warnDeprecatedShopifyMetaWrite()
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

export function metaProductSetFilter(retailerIds: string[]): {
  retailer_id: { is_any: string[] }
} {
  return { retailer_id: { is_any: [...new Set(retailerIds.filter(Boolean))] } }
}

export async function upsertMetaProductSet(opts: {
  catalogId: string
  accessToken: string
  name: string
  retailerIds: string[]
  productSetId?: string | null
  coverImageUrl?: string | null
  description?: string | null
}): Promise<string | null> {
  const body = metaProductSetWriteBody(opts)
  const existingId = opts.productSetId?.trim()
  if (existingId) {
    await graphJson(`${META_API_BASE}/${encodeURIComponent(existingId)}`, opts.accessToken, body)
    return existingId
  }
  try {
    const created = await graphJson<{ id?: string }>(
      `${META_API_BASE}/${encodeURIComponent(opts.catalogId)}/product_sets`,
      opts.accessToken,
      body,
    )
    return created.id ? String(created.id) : null
  } catch (err) {
    if (!isSameProductSetFilterError(err)) throw err
    const reused =
      (await findMetaProductSetIdByName(
        opts.catalogId,
        opts.accessToken,
        opts.name,
      )) ||
      (await findMetaProductSetIdByFilter(
        opts.catalogId,
        opts.accessToken,
        opts.retailerIds,
      ))
    if (!reused) throw err
    await graphJson(`${META_API_BASE}/${encodeURIComponent(reused)}`, opts.accessToken, body)
    return reused
  }
}

export function metaProductSetWriteBody(opts: {
  name: string
  retailerIds: string[]
  coverImageUrl?: string | null
  description?: string | null
}): Record<string, unknown> {
  const metadata: Record<string, string> = {
    description: (opts.description ?? opts.name).trim().slice(0, 200),
  }
  const cover = opts.coverImageUrl?.trim()
  if (cover && /^https:\/\//i.test(cover)) {
    metadata.cover_image_url = cover
  }
  return {
    name: opts.name.slice(0, 100),
    filter: JSON.stringify(metaProductSetFilter(opts.retailerIds)),
    metadata,
  }
}

function isSameProductSetFilterError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /same filters already exists/i.test(message)
}

export async function findMetaProductSetIdByFilter(
  catalogId: string,
  accessToken: string,
  retailerIds: string[],
): Promise<string | null> {
  const wanted = new Set(retailerIds.map((id) => id.trim()).filter(Boolean))
  if (wanted.size === 0) return null
  const rows = await listMetaProductSets(catalogId, accessToken)
  for (const row of rows) {
    const ids = retailerIdsFromMetaFilter(row.filter)
    if (ids.length !== wanted.size) continue
    if (ids.every((id) => wanted.has(id))) {
      const id = String(row.id ?? '').trim()
      if (id) return id
    }
  }
  return null
}

function retailerIdsFromMetaFilter(raw: unknown): string[] {
  let parsed = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return []
    }
  }
  const ids = (parsed as { retailer_id?: { is_any?: unknown[] } } | null)
    ?.retailer_id?.is_any
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
}

async function listMetaProductSets(
  catalogId: string,
  accessToken: string,
): Promise<{ id?: string; name?: string; filter?: unknown }[]> {
  const catalog = catalogId.trim()
  if (!catalog) return []
  const url = `${META_API_BASE}/${encodeURIComponent(catalog)}/product_sets?fields=id,name,filter`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return []
  }
  const body = (await res.json().catch(() => null)) as {
    data?: { id?: string; name?: string; filter?: unknown }[]
  } | null
  if (!res.ok) return []
  return body?.data ?? []
}

export async function findMetaProductSetIdByName(
  catalogId: string,
  accessToken: string,
  name: string,
): Promise<string | null> {
  const title = name.trim()
  if (!title) return null
  const match = (await listMetaProductSets(catalogId, accessToken)).find(
    (row) => (row.name ?? '').trim() === title,
  )
  const id = String(match?.id ?? '').trim()
  return id || null
}

export async function deleteMetaProductSet(
  productSetId: string,
  accessToken: string,
): Promise<void> {
  const id = productSetId.trim()
  if (!id) return
  await graphJson(`${META_API_BASE}/${encodeURIComponent(id)}`, accessToken, null, 'DELETE')
}

async function graphJson<T = Record<string, unknown>>(
  url: string,
  accessToken: string,
  body: Record<string, unknown> | null,
  method = 'POST',
): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new MetaCatalogGraphError(
      err instanceof Error ? err.message : String(err),
      0,
    )
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new MetaCatalogGraphError(
      payload?.error?.message || `Meta product set request failed (${res.status})`,
      res.status,
      parseRetryAfterMs(res.headers.get('Retry-After')),
    )
  }
  if (res.status === 204) return {} as T
  return ((await res.json().catch(() => ({}))) as T) ?? ({} as T)
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
  let res: Response
  try {
    res = await fetch(url, {
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
  } catch (err) {
    throw new MetaCatalogGraphError(
      err instanceof Error ? err.message : String(err),
      0,
    )
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new MetaCatalogGraphError(
      body?.error?.message || `Meta catalog sync failed (${res.status})`,
      res.status,
      parseRetryAfterMs(res.headers.get('Retry-After')),
    )
  }
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  if (!Number.isFinite(date)) return null
  return Math.max(0, date - Date.now())
}
