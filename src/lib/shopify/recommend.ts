import type { SupabaseClient } from '@supabase/supabase-js'
import { listBestSelling, searchProducts, searchProductsLive } from './catalog'
import { productUnitPrice } from './rank'
import { storefrontOrigin } from './domain'
import { numericIdFromGid } from './map-product'
import type { ShopifyProductCard, ShopifyProductHit, ShopifyStoreConfig } from './types'

export const BROWSE_RECOMMEND_LIMIT = 10
const MAX_SEED_TERMS = 5
const MAX_SEED_PRODUCTS = 3

const IGNORE_INTEREST =
  /^(whatsapp|wa|english|malayalam|hindi|tamil|telugu|kannada|voice|chat|sms|email)$/i

export type CustomerProductInterest = {
  products?: string[]
  preferences?: string[]
  intent?: string | null
  query?: string | null
}

export type RecommendRole = 'recommend' | 'upsell' | 'cross_sell'

export function parseRecommendRole(value: unknown): RecommendRole {
  return value === 'upsell' || value === 'cross_sell' ? value : 'recommend'
}

export function collectInterestTerms(interest: CustomerProductInterest): string[] {
  const raw = [
    interest.query,
    ...(interest.products ?? []),
    ...(interest.preferences ?? []),
    interest.intent,
  ]
  const seen = new Set<string>()
  const terms: string[] = []
  for (const item of raw) {
    const term = (typeof item === 'string' ? item : '').replace(/\s+/g, ' ').trim()
    if (term.length < 2 || IGNORE_INTEREST.test(term)) continue
    const key = term.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= MAX_SEED_TERMS) break
  }
  return terms
}

function numericProductId(hit: ShopifyProductHit): string {
  return numericIdFromGid(hit.id).replace(/\D/g, '')
}

function addUnique(
  out: ShopifyProductHit[],
  hits: ShopifyProductHit[],
  limit: number,
  excludeIds?: Set<string>,
): void {
  for (const hit of hits) {
    if (out.length >= limit) return
    if (!hit.id || excludeIds?.has(hit.id)) continue
    if (out.some((existing) => existing.id === hit.id)) continue
    out.push(hit)
  }
}

export async function fetchAjaxRecommendations(args: {
  primaryDomain: string | null
  productId: string
  limit?: number
  fetchImpl?: typeof fetch
}): Promise<{ handle: string; title: string }[]> {
  const origin = storefrontOrigin(args.primaryDomain)
  const id = args.productId.trim()
  if (!origin || !id) return []
  const limit = Math.min(10, Math.max(1, args.limit ?? BROWSE_RECOMMEND_LIMIT))
  const url = `${origin}/recommendations/products.json?product_id=${encodeURIComponent(id)}&limit=${limit}&intent=related`
  const fetchImpl = args.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return []
    const body = (await res.json().catch(() => null)) as {
      products?: { handle?: string | null; title?: string | null }[]
    } | null
    return (body?.products ?? [])
      .map((p) => ({
        handle: (p.handle || '').trim(),
        title: (p.title || '').trim(),
      }))
      .filter((p) => p.handle)
  } catch (err) {
    console.warn('[shopify recommend] ajax recommendations failed:', err)
    return []
  }
}

async function hydrateHandles(
  config: ShopifyStoreConfig,
  handles: string[],
  limit: number,
): Promise<ShopifyProductHit[]> {
  const unique = [...new Set(handles.map((h) => h.trim()).filter(Boolean))].slice(
    0,
    limit,
  )
  if (unique.length === 0) return []
  const query = unique.map((h) => `handle:${h}`).join(' OR ')
  try {
    return await searchProductsLive(config, query, { first: limit })
  } catch (err) {
    console.warn('[shopify recommend] hydrate handles failed:', err)
    return []
  }
}

export async function listRecommendedProducts(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  interest: CustomerProductInterest,
  opts?: {
    limit?: number
    shownCards?: ShopifyProductCard[]
    fetchImpl?: typeof fetch
    role?: RecommendRole
  },
): Promise<ShopifyProductHit[]> {
  const role = opts?.role ?? 'recommend'
  const limit = Math.min(
    BROWSE_RECOMMEND_LIMIT,
    Math.max(1, opts?.limit ?? (role === 'recommend' ? BROWSE_RECOMMEND_LIMIT : role === 'upsell' ? 1 : 2)),
  )
  const queryTerm = interest.query?.replace(/\s+/g, ' ').trim() || ''
  const memoryTerms = collectInterestTerms({ ...interest, query: null })
  const shownTitles = (opts?.shownCards ?? [])
    .map((card) => card.title?.trim())
    .filter((title): title is string => Boolean(title))
  const seedFromShown = role === 'upsell' || role === 'cross_sell'
  const seedTerms = seedFromShown && shownTitles.length > 0
    ? [...shownTitles]
    : queryTerm
      ? [queryTerm]
      : [...memoryTerms]
  if (!queryTerm && !seedFromShown) {
    for (const title of shownTitles) {
      if (seedTerms.length >= MAX_SEED_TERMS) break
      if (!seedTerms.some((t) => t.toLowerCase() === title.toLowerCase())) {
        seedTerms.push(title)
      }
    }
  }

  const seeds: ShopifyProductHit[] = []
  for (const term of seedTerms.slice(0, MAX_SEED_PRODUCTS)) {
    if (seeds.length >= MAX_SEED_PRODUCTS) break
    try {
      const hits = await searchProducts(db, config, term, 1)
      if (hits[0]) seeds.push(hits[0])
    } catch (err) {
      console.warn('[shopify recommend] seed search failed:', err)
    }
  }

  const recommended: ShopifyProductHit[] = []
  const seedIds = new Set(seeds.map((s) => s.id))
  const recHandles: string[] = []
  for (const seed of seeds) {
    const productId = numericProductId(seed)
    if (!productId) continue
    const ajax = await fetchAjaxRecommendations({
      primaryDomain: config.primaryDomain,
      productId,
      limit,
      fetchImpl: opts?.fetchImpl,
    })
    for (const item of ajax) recHandles.push(item.handle)
  }
  addUnique(recommended, await hydrateHandles(config, recHandles, limit), limit, seedIds)

  if (recommended.length < limit && role !== 'cross_sell') {
    const fillTerms = queryTerm ? [queryTerm, ...memoryTerms] : seedTerms
    for (const term of fillTerms) {
      if (recommended.length >= limit) break
      try {
        addUnique(
          recommended,
          await searchProducts(db, config, term, limit),
          limit,
          seedIds,
        )
      } catch (err) {
        console.warn('[shopify recommend] interest search failed:', err)
      }
    }
  }

  if (role === 'upsell') {
    const seedPrice = productUnitPrice(seeds[0] ?? recommended[0])
    const stepUp = recommended
      .filter((hit) => {
        const price = productUnitPrice(hit)
        if (price == null || seedPrice == null) return false
        if (price <= seedPrice) return false
        return price <= seedPrice * 1.5 || price - seedPrice <= 800
      })
      .sort((a, b) => (productUnitPrice(a) ?? 0) - (productUnitPrice(b) ?? 0))
    return stepUp.slice(0, limit)
  }

  if (recommended.length === 0) {
    if (role === 'cross_sell') return []
    return listBestSelling(db, config, limit)
  }
  return recommended.slice(0, limit)
}
