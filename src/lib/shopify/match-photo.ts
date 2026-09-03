import type { SupabaseClient } from '@supabase/supabase-js'
import {
  flattenShoppingVisionDescription,
  IMAGE_PLACEHOLDER,
  PRODUCT_PHOTO_PLACEHOLDER,
  resolveVisionImageUrl,
  shoppingSearchQueriesFromDescription,
} from '@/lib/ai/describe-inbound-image'
import {
  hydrateListingImages,
  listNewArrivals,
  searchCatalogSnapshot,
  searchProductsLive,
} from './catalog'
import { confirmCatalogMatchesFromPhoto } from './confirm-photo'
import {
  rankProductsByDescription,
  scoreProductAgainstDescription,
  tokensFromDescription,
} from './rank'
import type { ShopifyProductHit, ShopifyStoreConfig } from './types'

const MAX_TOKEN_QUERIES = 5
const MAX_CONFIRM_POOL = 8
const MAX_CONFIRMED_HITS = 2

export type ConfirmCatalogMatchesFn = (args: {
  customerImageUrl: string
  candidates: ShopifyProductHit[]
}) => Promise<ShopifyProductHit[] | null>

export interface MatchProductsFromPhotoOpts {
  customerImageUrl?: string | null
  customerMediaId?: string | null
  accessToken?: string | null
  apiKey?: string | null
  fetchImpl?: typeof fetch
  confirmImpl?: ConfirmCatalogMatchesFn
}

/**
 * Deterministic catalog match for a vision description of a customer
 * photo. Searches snapshot + live Shopify (union), then vision-confirms
 * against catalog listing images when possible. Returns 0–2 hits that
 * vision (or token rank on API failure) actually selected — never invents
 * products.
 */
export async function matchProductsFromPhoto(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  description: string,
  opts: MatchProductsFromPhotoOpts = {},
): Promise<ShopifyProductHit[]> {
  if (isUnusablePhotoDescription(description)) return []

  const desc = flattenShoppingVisionDescription(description.trim())
  const tokens = tokensFromDescription(desc)
  if (tokens.length === 0) return []

  const seen = new Set<string>()
  const candidates: ShopifyProductHit[] = []

  const add = (hits: ShopifyProductHit[]) => {
    for (const hit of hits) {
      if (!hit.id || seen.has(hit.id)) continue
      seen.add(hit.id)
      candidates.push(hit)
    }
  }

  const queries = photoMatchQueries(description)
  await Promise.all(
    queries.map(async (q) => {
      try {
        add(await searchCatalogSnapshot(db, config.accountId, q, 8))
      } catch (err) {
        console.warn('[shopify match-photo] snapshot search failed:', err)
      }
      try {
        add(await searchProductsLive(config, q, { first: 8 }))
      } catch (err) {
        console.warn('[shopify match-photo] live search failed:', err)
      }
    }),
  )

  if (candidates.length === 0) {
    try {
      add(await listNewArrivals(db, config, 8))
    } catch (err) {
      console.warn('[shopify match-photo] new arrivals failed:', err)
    }
    if (candidates.length === 0) {
      try {
        add(await searchProductsLive(config, 'status:active', { first: 8 }))
      } catch (err) {
        console.warn('[shopify match-photo] live catalog failed:', err)
      }
    }
  }

  if (candidates.length === 0) return []

  const scored = candidates
    .map((p) => ({ p, score: scoreProductAgainstDescription(p, tokens) }))
    .sort((a, b) => b.score - a.score)
  const pool = scored.map((s) => s.p).slice(0, MAX_CONFIRM_POOL)

  const confirmed = await maybeConfirmCatalogImages(config, pool, opts)
  if (confirmed) return confirmed.slice(0, MAX_CONFIRMED_HITS)

  return rankProductsByDescription(desc, pool)
    .filter((p) => scoreProductAgainstDescription(p, tokens) > 0)
    .slice(0, 3)
}

export function isUnusablePhotoDescription(description: string): boolean {
  const desc = description.trim()
  if (!desc) return true
  return desc === PRODUCT_PHOTO_PLACEHOLDER || desc === IMAGE_PLACEHOLDER
}

/**
 * Token/phrase queries only — never the full vision paragraph, which
 * almost never ILIKE-matches a catalog title. Prefers structured
 * `searchQueries` from shopping vision JSON when present.
 */
export function photoMatchQueries(description: string): string[] {
  const tokens = tokensFromDescription(
    flattenShoppingVisionDescription(description),
  )
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const q = raw.trim().slice(0, 80)
    if (!q) return
    const key = q.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(q)
  }
  for (const q of shoppingSearchQueriesFromDescription(description)) push(q)
  if (tokens.length >= 2) {
    push(tokens.slice(0, Math.min(3, tokens.length)).join(' '))
  }
  if (tokens.length >= 4) {
    push(tokens.slice(0, 2).join(' '))
  }
  for (const token of tokens.slice(0, MAX_TOKEN_QUERIES)) push(token)
  return out
}

function hasListingImage(hit: ShopifyProductHit): boolean {
  return Boolean(hit.imageUrl?.trim() || hit.imageUrls?.some((u) => u.trim()))
}

async function maybeConfirmCatalogImages(
  config: ShopifyStoreConfig,
  pool: ShopifyProductHit[],
  opts: MatchProductsFromPhotoOpts,
): Promise<ShopifyProductHit[] | null> {
  if (pool.length < 1) return null

  let imaged = pool.filter(hasListingImage)
  if (imaged.length < 1 && !opts.confirmImpl) return null

  let customerImageUrl = opts.customerImageUrl?.trim() || ''
  if (
    customerImageUrl &&
    !customerImageUrl.startsWith('https://') &&
    !customerImageUrl.startsWith('data:')
  ) {
    customerImageUrl = ''
  }
  if (!customerImageUrl && (opts.customerMediaId || opts.customerImageUrl)) {
    try {
      customerImageUrl =
        (await resolveVisionImageUrl({
          provider: 'openai',
          apiKey: opts.apiKey || '',
          mediaUrl: opts.customerImageUrl ?? null,
          caption: null,
          mediaId: opts.customerMediaId ?? null,
          accessToken: opts.accessToken ?? null,
          fetchImpl: opts.fetchImpl,
        })) || ''
    } catch (err) {
      console.warn('[shopify match-photo] resolve customer image failed:', err)
    }
  }

  if (opts.confirmImpl) {
    try {
      return await opts.confirmImpl({
        customerImageUrl: customerImageUrl || opts.customerImageUrl || '',
        candidates: pool,
      })
    } catch (err) {
      console.warn('[shopify match-photo] confirmImpl failed:', err)
      return null
    }
  }

  if (!customerImageUrl || !opts.apiKey) return null

  try {
    imaged = (await hydrateListingImages(config, imaged)).filter(hasListingImage)
  } catch (err) {
    console.warn('[shopify match-photo] listing image hydrate failed:', err)
  }
  if (imaged.length < 1) return null

  try {
    return await confirmCatalogMatchesFromPhoto({
      apiKey: opts.apiKey,
      customerImageUrl,
      candidates: imaged,
      fetchImpl: opts.fetchImpl,
    })
  } catch (err) {
    console.warn('[shopify match-photo] vision confirm failed:', err)
    return null
  }
}
