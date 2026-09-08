import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_PRODUCT_CARDS } from '@/lib/ai/product-card-limit'
import { catalogProductToHit } from '@/lib/catalog/search/map-hit'
import { lookupCatalogProduct } from '@/lib/catalog/search/lookup'
import type { CatalogProduct } from '@/lib/catalog/core/types'
import { attachCatalogFacts, getCatalogProductsByHandles } from '@/lib/catalog/intelligence/facts'
import { listRelatedProducts } from '@/lib/catalog/intelligence/relations'
import {
  findAlternativeProducts,
  findSimilarProducts,
  hasAvailableOption,
  isModestStepUp,
  seedVariantMatch,
} from '@/lib/catalog/intelligence/similar'
import {
  getRecommendations,
  loadCatalogSalesMode,
  loadCommerceRecommendSignals,
  resolveRecommendLimit,
} from '@/lib/catalog/intelligence/recommend'
import {
  mergeAndPersistShoppingContext,
} from '@/lib/catalog/intelligence/shopping-context'
import type {
  RecommendIntent,
  ShoppingRequirements,
} from '@/lib/catalog/intelligence/types'
import { listNewArrivals, searchProducts } from './catalog'
import { productUnitPrice } from './rank'
import { storefrontOrigin } from './domain'
import { numericIdFromGid } from './map-product'
import type { ShopifyProductCard, ShopifyProductHit, ShopifyStoreConfig } from './types'

export const BROWSE_RECOMMEND_LIMIT = MAX_PRODUCT_CARDS
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

export type RecommendRole = RecommendIntent

export function parseRecommendRole(value: unknown): RecommendRole {
  if (
    value === 'upsell' ||
    value === 'cross_sell' ||
    value === 'similar' ||
    value === 'alternative' ||
    value === 'bundle'
  ) {
    return value
  }
  return 'recommend'
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
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  handles: string[],
  limit: number,
): Promise<ShopifyProductHit[]> {
  const unique = [...new Set(handles.map((h) => h.trim()).filter(Boolean))].slice(
    0,
    limit,
  )
  if (unique.length === 0) return []
  try {
    const products = await getCatalogProductsByHandles(db, config.accountId, unique)
    const byHandle = new Map(products.map((product) => [product.handle, product]))
    const hits: ShopifyProductHit[] = []
    for (const handle of unique) {
      const product = byHandle.get(handle)
      if (!product || product.status !== 'active') continue
      hits.push(
        catalogProductToHit(product, {
          primaryDomain: config.primaryDomain,
          currency: config.currency ?? product.currency,
        }),
      )
      if (hits.length >= limit) break
    }
    return hits
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
    seedId?: string
    customerText?: string | null
    filters?: ShoppingRequirements
    contactId?: string | null
    conversationId?: string | null
    cartRetailerIds?: string[]
    selectedIds?: string[]
  },
): Promise<ShopifyProductHit[]> {
  const role = opts?.role ?? 'recommend'
  const salesMode = await loadCatalogSalesMode(db, config.accountId)
  if (salesMode !== 'off') {
    const phase4 = await recommendWithSalesAutomation(db, config, interest, opts, role)
    if (salesMode === 'on') return phase4
    const legacy = await listRecommendedProductsLegacy(db, config, interest, opts, role)
    logCatalogIntelShadow(config.accountId, role, phase4, legacy)
    return legacy
  }
  return listRecommendedProductsLegacy(db, config, interest, opts, role)
}

async function recommendWithSalesAutomation(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  interest: CustomerProductInterest,
  opts: {
    limit?: number
    shownCards?: ShopifyProductCard[]
    role?: RecommendRole
    seedId?: string
    customerText?: string | null
    filters?: ShoppingRequirements
    contactId?: string | null
    conversationId?: string | null
    cartRetailerIds?: string[]
    selectedIds?: string[]
  } | undefined,
  role: RecommendRole,
): Promise<ShopifyProductHit[]> {
  const limit = Math.min(
    BROWSE_RECOMMEND_LIMIT,
    resolveRecommendLimit(role, opts?.limit),
  )
  const commerce = await loadCommerceRecommendSignals(
    db,
    config.accountId,
    opts?.contactId,
  )
  const shownIds = (opts?.shownCards ?? [])
    .map((card) => card.catalogId || card.handle || '')
    .filter(Boolean)
  const shopping = await mergeAndPersistShoppingContext(db, {
    accountId: config.accountId,
    contactId: opts?.contactId,
    conversationId: opts?.conversationId,
    text: opts?.customerText ?? interest.query,
    shownIds,
    selectedIds: opts?.selectedIds,
    requirements: opts?.filters,
    mode: role,
    seedId: opts?.seedId,
    hasCart: Boolean(opts?.cartRetailerIds?.length || commerce.hasCart),
    hasPendingCheckout: commerce.hasPendingCheckout,
    hasPaidOrder: commerce.hasPaidOrder,
  })
  const ranked = await getRecommendations(db, {
    accountId: config.accountId,
    contactId: opts?.contactId,
    conversationId: opts?.conversationId,
    mode: role,
    seedId: opts?.seedId,
    selectedIds: opts?.selectedIds,
    cartRetailerIds: opts?.cartRetailerIds ?? commerce.cartRetailerIds,
    requirements: opts?.filters,
    shopping,
    limit,
    shopName: config.shopName,
    customerText: opts?.customerText ?? interest.query,
  })
  return ranked.map((row) => {
    const hit = catalogProductToHit(row.product, {
      primaryDomain: config.primaryDomain,
      currency: config.currency ?? row.product.currency,
    })
    hit.recommendReasons = row.reasons
    hit.recommendMode = row.mode
    hit.recommendScore = row.score
    return hit
  })
}

function logCatalogIntelShadow(
  accountId: string,
  role: RecommendRole,
  phase4: ShopifyProductHit[],
  legacy: ShopifyProductHit[],
): void {
  console.info('[catalog-intel]', {
    accountId,
    tool: 'recommend-shadow',
    mode: role,
    phase4Ids: phase4.map((hit) => hit.catalogId ?? hit.id),
    phase3Ids: legacy.map((hit) => hit.catalogId ?? hit.id),
  })
}

async function listRecommendedProductsLegacy(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  interest: CustomerProductInterest,
  opts: {
    limit?: number
    shownCards?: ShopifyProductCard[]
    fetchImpl?: typeof fetch
    role?: RecommendRole
    seedId?: string
    customerText?: string | null
    filters?: ShoppingRequirements
  } | undefined,
  role: RecommendRole,
): Promise<ShopifyProductHit[]> {
  const limit = Math.min(
    BROWSE_RECOMMEND_LIMIT,
    Math.max(1, opts?.limit ?? (role === 'recommend' || role === 'similar' || role === 'alternative' ? BROWSE_RECOMMEND_LIMIT : role === 'upsell' ? 1 : 2)),
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
  try {
    addUnique(
      recommended,
      await recommendFromCatalog(db, config, {
        role,
        limit,
        seeds,
        seedId: opts?.seedId,
        shownCards: opts?.shownCards ?? [],
        filters: opts?.filters,
      }),
      limit,
    )
  } catch (err) {
    console.warn('[catalog-intel] recommend failed', err)
  }

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
  addUnique(recommended, await hydrateHandles(db, config, recHandles, limit), limit, seedIds)

  const budgetLocked = Boolean(opts?.filters?.maxPrice != null || opts?.filters?.cheaper)
  if (recommended.length < limit && role !== 'cross_sell' && !budgetLocked) {
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
        return isModestStepUp(seedPrice, price)
      })
      .sort((a, b) => (productUnitPrice(a) ?? 0) - (productUnitPrice(b) ?? 0))
    return stepUp.slice(0, limit)
  }

  if (recommended.length === 0) {
    if (role === 'cross_sell' || budgetLocked) return []
    return listNewArrivals(db, config, limit)
  }
  return recommended.slice(0, limit)
}

async function recommendFromCatalog(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  args: {
    role: RecommendRole
    limit: number
    seeds: ShopifyProductHit[]
    seedId?: string
    shownCards: ShopifyProductCard[]
    filters?: ShoppingRequirements
  },
): Promise<ShopifyProductHit[]> {
  const seed = await resolveSeedProduct(db, config, args)
  if (!seed) return []
  const [withFacts] = await attachCatalogFacts(db, config.accountId, [seed])
  const seedProduct = withFacts ?? seed
  const seedMatch =
    args.filters?.optionValue && seedVariantMatch(seedProduct, args.filters)
      ? seedProduct
      : null

  const relationKinds =
    args.role === 'upsell'
      ? (['upsell'] as const)
      : args.role === 'cross_sell'
        ? (['cross_sell'] as const)
        : (['similar'] as const)
  const related = (
    await listRelatedProducts(
      db,
      config.accountId,
      seedProduct.id,
      [...relationKinds],
    )
  ).filter((product) =>
    matchesRecommendFilters(product, seedProduct, args.filters, args.role),
  )
  const relatedIds = new Set(related.map((product) => product.id))

  if (args.role === 'cross_sell') {
    if (related.length > 0) return toHits(related, config, args.limit)
    const collectionId = seedProduct.collections?.[0]?.id
    if (!collectionId) return []
    const ranked = await findSimilarProducts(db, {
      accountId: config.accountId,
      seed: seedProduct,
      limit: args.limit,
      shopName: config.shopName,
      relatedIds,
    })
    return toHits(
      ranked
        .filter((row) => row.reasons.includes('same_collection'))
        .map((row) => row.product),
      config,
      args.limit,
    )
  }

  const intent =
    args.role === 'upsell'
      ? 'upsell'
      : args.role === 'alternative' || args.filters?.cheaper
        ? args.filters?.cheaper
          ? 'cheaper'
          : 'alternative'
        : 'similar'
  const ranked =
    intent === 'similar'
      ? await findSimilarProducts(db, {
          accountId: config.accountId,
          seed: seedProduct,
          limit: args.limit,
          shopName: config.shopName,
          requirements: args.filters,
          relatedIds,
          intent,
        })
      : await findAlternativeProducts(db, {
          accountId: config.accountId,
          seed: seedProduct,
          limit: args.limit,
          shopName: config.shopName,
          requirements: args.filters,
          relatedIds,
          intent,
        })
  const fill = ranked
    .map((row) => row.product)
    .filter((product) => !relatedIds.has(product.id) && product.id !== seedProduct.id)
  return toHits(
    [...(seedMatch ? [seedMatch] : []), ...related, ...fill],
    config,
    args.limit,
  )
}

async function resolveSeedProduct(
  db: SupabaseClient,
  config: ShopifyStoreConfig,
  args: {
    seedId?: string
    seeds: ShopifyProductHit[]
    shownCards: ShopifyProductCard[]
  },
): Promise<CatalogProduct | null> {
  const candidates = [
    args.seedId,
    ...args.seeds.flatMap((hit) => [hit.catalogId, hit.handle, hit.id]),
    ...args.shownCards.flatMap((card) => [card.handle, card.title]),
  ]
  for (const id of candidates) {
    if (!id?.trim()) continue
    const product = await lookupCatalogProduct(db, config.accountId, id)
    if (product) return product
  }
  return null
}

function matchesRecommendFilters(
  product: CatalogProduct,
  seed: CatalogProduct,
  filters: ShoppingRequirements | undefined,
  role: RecommendRole,
): boolean {
  if (
    filters?.maxPrice != null &&
    (product.priceMin ?? Number.POSITIVE_INFINITY) > filters.maxPrice
  ) {
    return false
  }
  if (filters?.minPrice != null && (product.priceMax ?? 0) < filters.minPrice) {
    return false
  }
  if (
    filters?.cheaper &&
    seed.priceMin != null &&
    (product.priceMax == null || product.priceMax >= seed.priceMin)
  ) {
    return false
  }
  if (role === 'upsell' && !isModestStepUp(seed.priceMin, product.priceMin)) {
    return false
  }
  if (
    filters?.optionValue &&
    !hasAvailableOption(product, filters.optionName, filters.optionValue)
  ) {
    return false
  }
  if (filters?.attributeKey && filters.attributeValue) {
    const key = filters.attributeKey.toLowerCase()
    const value = filters.attributeValue.toLowerCase()
    const ok = (product.attributes ?? []).some(
      (attr) => attr.key.toLowerCase() === key && attr.value.toLowerCase() === value,
    )
    if (!ok) return false
  }
  return true
}

function toHits(
  products: CatalogProduct[],
  config: ShopifyStoreConfig,
  limit: number,
): ShopifyProductHit[] {
  return products
    .filter((product) => product.status === 'active')
    .slice(0, limit)
    .map((product) =>
      catalogProductToHit(product, {
        primaryDomain: config.primaryDomain,
        currency: config.currency ?? product.currency,
      }),
    )
}
