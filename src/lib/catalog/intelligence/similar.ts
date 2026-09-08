import type { SupabaseClient } from '@supabase/supabase-js'
import { searchCatalog } from '../search/query'
import { applyCatalogHardFilters } from '../search/hybrid'
import {
  loadCatalogHybridMode,
  resolveCatalogEmbeddingsKey,
  semanticNeighborsForProduct,
} from '../search/semantic'
import type { CatalogProduct } from '../core/types'
import {
  attachCatalogFacts,
  getCatalogProductsByIds,
  logCatalogIntel,
} from './facts'
import {
  CANDIDATE_CAP,
  type RankedCatalogProduct,
  type RecommendReason,
  type ShoppingRequirements,
  type SimilarQuery,
} from './types'

const PRICE_BAND = 0.3

export async function findSimilarProducts(
  db: SupabaseClient,
  query: SimilarQuery,
): Promise<RankedCatalogProduct[]> {
  return rankCandidates(db, { ...query, intent: query.intent ?? 'similar' })
}

export async function findAlternativeProducts(
  db: SupabaseClient,
  query: SimilarQuery,
): Promise<RankedCatalogProduct[]> {
  return rankCandidates(db, {
    ...query,
    intent: query.intent ?? 'alternative',
  })
}

async function rankCandidates(
  db: SupabaseClient,
  query: SimilarQuery,
): Promise<RankedCatalogProduct[]> {
  const limit = Math.min(CANDIDATE_CAP, Math.max(1, query.limit ?? 10))
  const requirements = query.requirements ?? {}
  const seed = query.seed
  const seedPrice = seed.priceMin
  const priceMax =
    requirements.maxPrice ??
    (query.intent === 'cheaper' || requirements.cheaper
      ? seedPrice != null
        ? seedPrice - 0.01
        : undefined
      : undefined)
  const priceMin =
    requirements.minPrice ??
    (query.intent === 'upsell' && seedPrice != null ? seedPrice + 0.01 : undefined)

  let candidates = await searchCatalog(db, {
    accountId: query.accountId,
    status: 'active',
    inStock: true,
    priceMin,
    priceMax,
    attribute:
      requirements.attributeKey && requirements.attributeValue
        ? {
            key: requirements.attributeKey,
            value: requirements.attributeValue,
          }
        : undefined,
    option:
      requirements.optionName && requirements.optionValue
        ? {
            name: requirements.optionName,
            value: requirements.optionValue,
          }
        : undefined,
    limit: CANDIDATE_CAP,
  })
  candidates = await attachCatalogFacts(db, query.accountId, candidates)
  const semanticExtra = await semanticCandidateFill(db, query.accountId, seed.id)
  if (semanticExtra.length > 0) {
    const seen = new Set(candidates.map((product) => product.id))
    for (const product of semanticExtra) {
      if (seen.has(product.id)) continue
      seen.add(product.id)
      candidates.push(product)
    }
  }
  candidates = applyCatalogHardFilters(candidates, {
    accountId: query.accountId,
    status: 'active',
    inStock: true,
    priceMin,
    priceMax,
    attribute:
      requirements.attributeKey && requirements.attributeValue
        ? {
            key: requirements.attributeKey,
            value: requirements.attributeValue,
          }
        : undefined,
    option:
      requirements.optionName && requirements.optionValue
        ? {
            name: requirements.optionName,
            value: requirements.optionValue,
          }
        : undefined,
  }).slice(0, CANDIDATE_CAP)
  candidates = candidates.filter((product) => product.id !== seed.id)
  if (requirements.optionValue) {
    candidates = candidates.filter((product) =>
      hasAvailableOption(
        product,
        requirements.optionName,
        requirements.optionValue!,
      ),
    )
  }
  if (query.intent === 'upsell') {
    candidates = candidates.filter((product) =>
      isModestStepUp(seedPrice, product.priceMin),
    )
  }
  if (query.intent === 'cheaper' || requirements.cheaper) {
    candidates = candidates.filter((product) =>
      product.priceMax != null &&
      seedPrice != null &&
      product.priceMax < seedPrice,
    )
  }

  const ranked = candidates
    .map((product) => scoreProduct(seed, product, query))
    .filter((row) => row.score > 0 || query.intent === 'cheaper' || query.intent === 'upsell')
    .sort((a, b) => b.score - a.score || comparePrice(a.product, b.product))
    .slice(0, limit)

  logCatalogIntel({
    accountId: query.accountId,
    tool: query.intent ?? 'similar',
    count: ranked.length,
    extra: { seedId: seed.id },
  })
  return ranked
}

export function scoreProduct(
  seed: CatalogProduct,
  product: CatalogProduct,
  query: Pick<SimilarQuery, 'shopName' | 'relatedIds' | 'intent'>,
): RankedCatalogProduct {
  let score = 0
  const reasons: RecommendReason[] = []
  if (sharedCollections(seed, product).length > 0) {
    score += 5
    reasons.push('same_collection')
  }
  if (sharedOptionValues(seed, product).length > 0) {
    score += 3
    reasons.push('same_options')
  }
  if (sharedAttributeValues(seed, product).length > 0) {
    score += 3
    reasons.push('same_attribute')
  }
  if (inPriceBand(seed.priceMin, product.priceMin)) {
    score += 2
    reasons.push('price_band')
  }
  if (sameRealBrand(seed, product, query.shopName)) {
    score += 1
    reasons.push('same_brand')
  }
  if (query.relatedIds?.has(product.id)) {
    score += 4
    reasons.push(
      query.intent === 'upsell'
        ? 'relation_upsell'
        : query.intent === 'alternative'
          ? 'relation_similar'
          : 'relation_similar',
    )
  }
  if (
    seed.priceMin != null &&
    product.priceMax != null &&
    product.priceMax < seed.priceMin
  ) {
    reasons.push('lower_price')
    if (query.intent === 'cheaper') score += 2
  }
  if (
    seed.priceMin != null &&
    product.priceMin != null &&
    product.priceMin > seed.priceMin
  ) {
    reasons.push('higher_price')
    if (query.intent === 'upsell') score += 2
  }
  return { product, score, reasons }
}

export function hasAvailableOption(
  product: CatalogProduct,
  name: string | undefined,
  value: string,
): boolean {
  const want = value.trim().toLowerCase()
  const wantName = name?.trim().toLowerCase()
  return product.variants.some((variant) => {
    if (!variant.available) return false
    return variant.options.some((opt) => {
      const matchesValue = opt.value.trim().toLowerCase() === want
      if (!matchesValue) return false
      if (!wantName) return true
      return opt.name.trim().toLowerCase() === wantName
    })
  })
}

export function isModestStepUp(
  seedPrice: number | null | undefined,
  candidatePrice: number | null | undefined,
): boolean {
  if (seedPrice == null || candidatePrice == null) return false
  if (candidatePrice <= seedPrice) return false
  return candidatePrice <= seedPrice * 1.5 || candidatePrice - seedPrice <= 800
}

export function seedVariantMatch(
  seed: CatalogProduct,
  requirements: ShoppingRequirements,
): CatalogProduct | null {
  if (!requirements.optionValue) return seed
  const ok = hasAvailableOption(seed, requirements.optionName, requirements.optionValue)
  return ok ? seed : null
}

function sharedCollections(seed: CatalogProduct, product: CatalogProduct): string[] {
  const seedIds = new Set((seed.collections ?? []).map((col) => col.id))
  return (product.collections ?? [])
    .filter((col) => seedIds.has(col.id))
    .map((col) => col.id)
}

function sharedOptionValues(seed: CatalogProduct, product: CatalogProduct): string[] {
  const seedValues = new Set(
    seed.variants.flatMap((variant) =>
      variant.options.map((opt) => `${opt.name}:${opt.value}`.toLowerCase()),
    ),
  )
  return unique(
    product.variants.flatMap((variant) =>
      variant.options
        .map((opt) => `${opt.name}:${opt.value}`.toLowerCase())
        .filter((key) => seedValues.has(key)),
    ),
  )
}

function sharedAttributeValues(
  seed: CatalogProduct,
  product: CatalogProduct,
): string[] {
  const seedValues = new Set(
    (seed.attributes ?? []).map((attr) => `${attr.key}:${attr.value}`.toLowerCase()),
  )
  return unique(
    (product.attributes ?? [])
      .map((attr) => `${attr.key}:${attr.value}`.toLowerCase())
      .filter((key) => seedValues.has(key)),
  )
}

function inPriceBand(
  seedPrice: number | null | undefined,
  candidatePrice: number | null | undefined,
): boolean {
  if (seedPrice == null || candidatePrice == null) return false
  const delta = Math.abs(candidatePrice - seedPrice)
  return delta <= seedPrice * PRICE_BAND || delta <= 200
}

function sameRealBrand(
  seed: CatalogProduct,
  product: CatalogProduct,
  shopName?: string | null,
): boolean {
  const a = seed.brand?.trim().toLowerCase()
  const b = product.brand?.trim().toLowerCase()
  if (!a || !b || a !== b) return false
  const shop = shopName?.trim().toLowerCase()
  return !shop || a !== shop
}

function comparePrice(a: CatalogProduct, b: CatalogProduct): number {
  return (a.priceMin ?? Number.POSITIVE_INFINITY) - (b.priceMin ?? Number.POSITIVE_INFINITY)
}

async function semanticCandidateFill(
  db: SupabaseClient,
  accountId: string,
  seedId: string,
): Promise<CatalogProduct[]> {
  try {
    const mode = await loadCatalogHybridMode(db, accountId)
    if (mode === 'off') return []
    const key = await resolveCatalogEmbeddingsKey(db, accountId)
    const ids = await semanticNeighborsForProduct(db, accountId, seedId, key)
    if (ids.length === 0) return []
    return getCatalogProductsByIds(db, accountId, ids)
  } catch {
    return []
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
