import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogProduct } from '../core/types'
import { applyCatalogHardFilters } from '../search/hybrid'
import { lookupCatalogProduct } from '../search/lookup'
import { searchCatalog } from '../search/query'
import {
  loadCatalogHybridMode,
  resolveCatalogEmbeddingsKey,
  semanticNeighborsForProduct,
} from '../search/semantic'
import { getCatalogProductsByIds, logCatalogIntel } from './facts'
import { validateCatalogIds } from './shopping-context'
import { listRelatedProducts, relatedIdsFor } from './relations'
import { parseShoppingRequirements } from './requirements'
import {
  findAlternativeProducts,
  findSimilarProducts,
  hasAvailableOption,
  isModestStepUp,
} from './similar'
import type {
  CatalogSalesMode,
  RankedRecommendation,
  RecommendIntent,
  RecommendReason,
  ShoppingContext,
  ShoppingRequirements,
} from './types'
import { CANDIDATE_CAP } from './types'

const PRODUCT_TYPES = [
  'saree',
  'sari',
  'bag',
  'tote',
  'backpack',
  'clutch',
  'pouch',
  'blouse',
  'kurta',
  'dress',
  'shoe',
  'sandal',
  'wallet',
  'belt',
  'earring',
  'necklace',
  'ring',
  'watch',
  'scarf',
  'shawl',
] as const

export type GetRecommendationsInput = {
  accountId: string
  contactId?: string | null
  conversationId?: string | null
  mode: RecommendIntent
  seedId?: string | null
  selectedIds?: string[]
  cartRetailerIds?: string[]
  requirements?: ShoppingRequirements
  shopping?: ShoppingContext
  limit?: number
  shopName?: string | null
  customerText?: string | null
}

export async function loadCatalogSalesMode(
  db: SupabaseClient,
  accountId: string,
): Promise<CatalogSalesMode> {
  try {
    const { data, error } = await db
      .from('ai_configs')
      .select('catalog_sales_automation')
      .eq('account_id', accountId)
      .maybeSingle()
    if (error || !data) return 'off'
    const mode = (data as { catalog_sales_automation?: string })
      .catalog_sales_automation
    if (mode === 'shadow' || mode === 'on') return mode
    return 'off'
  } catch {
    return 'off'
  }
}

export function resolveRecommendLimit(
  mode: RecommendIntent,
  requested?: number,
): number {
  if (mode === 'upsell') return 1
  if (mode === 'cross_sell') return Math.min(2, Math.max(1, requested ?? 2))
  if (mode === 'bundle') return Math.min(4, Math.max(2, requested ?? 4))
  if (mode === 'alternative') return Math.min(3, Math.max(1, requested ?? 3))
  if (requested != null) return Math.min(CANDIDATE_CAP, Math.max(1, requested))
  return 10
}

export async function getRecommendations(
  db: SupabaseClient,
  input: GetRecommendationsInput,
): Promise<RankedRecommendation[]> {
  const mode = input.mode
  const limit = resolveRecommendLimit(mode, input.limit)
  const requirements =
    input.requirements ?? parseShoppingRequirements(input.customerText)
  const shopping = input.shopping
  const mergedReq = mergeRequirements(requirements, shopping)

  const commerce = await loadCommerceRecommendSignals(
    db,
    input.accountId,
    input.contactId,
  )
  const seed = await resolveSeed(db, input, commerce.paidRetailerIds)
  const exclude = await collectExclusions(db, input, seed, commerce)
  let ranked: RankedRecommendation[] = []

  try {
    if (mode === 'bundle') {
      ranked = await recommendBundle(db, input, seed, mergedReq, exclude, limit)
    } else if (mode === 'cross_sell') {
      ranked = await recommendCrossSell(db, input, seed, mergedReq, exclude, limit)
    } else if (mode === 'upsell') {
      ranked = await recommendUpsell(db, input, seed, mergedReq, exclude, limit)
    } else if (mode === 'alternative') {
      ranked = await recommendAlternative(db, input, seed, mergedReq, exclude, limit)
    } else {
      ranked = await recommendSimilar(db, input, seed, mergedReq, exclude, limit)
    }
  } catch (err) {
    console.warn('[catalog-intel] getRecommendations failed', err)
    ranked = []
  }

  ranked = ranked.filter((row) => !exclude.has(row.product.id))
  await recordRecommendationEvents(db, {
    accountId: input.accountId,
    contactId: input.contactId,
    conversationId: input.conversationId,
    mode,
    seedProductId: seed?.id ?? null,
    rows: ranked,
    event: 'generated',
  })
  logCatalogIntel({
    accountId: input.accountId,
    tool: `recommend-${mode}`,
    count: ranked.length,
    extra: {
      seedId: seed?.id ?? null,
      reasons: ranked.flatMap((row) => row.reasons),
    },
  })
  return ranked
}

export async function recordRecommendationEvents(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId?: string | null
    conversationId?: string | null
    mode: RecommendIntent | string
    seedProductId?: string | null
    rows: { product: { id: string }; score: number; reasons: RecommendReason[] }[]
    event: 'generated' | 'shown'
  },
): Promise<void> {
  if (args.rows.length === 0) return
  try {
    const payload = args.rows.map((row) => ({
      account_id: args.accountId,
      contact_id: args.contactId ?? null,
      conversation_id: args.conversationId ?? null,
      mode: args.mode,
      seed_product_id: args.seedProductId ?? null,
      product_id: row.product.id,
      score: row.score,
      reasons: row.reasons,
      event: args.event,
    }))
    const { error } = await db.from('catalog_recommendation_events').insert(payload)
    if (error) throw error
  } catch (err) {
    console.warn('[catalog-intel] recommendation events failed', err)
  }
}

export async function recordShownRecommendationEvents(
  db: SupabaseClient,
  args: {
    accountId: string
    contactId?: string | null
    conversationId?: string | null
    productIds: string[]
    mode?: string | null
    seedProductId?: string | null
  },
): Promise<void> {
  const ids = await validateCatalogIds(
    db,
    args.accountId,
    args.productIds.filter(Boolean),
  )
  if (ids.length === 0) return
  const products = await getCatalogProductsByIds(db, args.accountId, ids).catch(
    () => [],
  )
  await recordRecommendationEvents(db, {
    accountId: args.accountId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    mode: args.mode ?? 'recommend',
    seedProductId: args.seedProductId ?? null,
    rows: products.map((product) => ({
      product,
      score: 0,
      reasons: [],
    })),
    event: 'shown',
  })
}

async function resolveSeed(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  paidRetailerIds: string[] = [],
): Promise<CatalogProduct | null> {
  const complementary =
    input.mode === 'cross_sell' ||
    input.mode === 'bundle' ||
    input.mode === 'upsell'
  const candidates = [
    input.seedId,
    ...(input.selectedIds ?? []),
    ...(input.shopping?.selectedIds ?? []),
    ...(complementary ? paidRetailerIds : []),
    input.shopping?.shownIds[0],
  ]
  for (const id of candidates) {
    if (!id?.trim()) continue
    const product = await lookupCatalogProduct(db, input.accountId, id)
    if (product && product.accountId === input.accountId) return product
  }
  return null
}

async function collectExclusions(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  commerce: Awaited<ReturnType<typeof loadCommerceRecommendSignals>>,
): Promise<Set<string>> {
  const exclude = new Set<string>()
  if (seed) exclude.add(seed.id)
  for (const id of input.shopping?.rejectedIds ?? []) exclude.add(id)
  for (const id of input.shopping?.selectedIds ?? []) exclude.add(id)
  for (const id of input.selectedIds ?? []) exclude.add(id)
  const retailerIds = [
    ...(input.cartRetailerIds ?? []),
    ...commerce.cartRetailerIds,
    ...commerce.paidRetailerIds,
  ]
  if (retailerIds.length > 0) {
    const mapped = await mapRetailerIds(db, input.accountId, retailerIds)
    for (const id of mapped) exclude.add(id)
  }
  return exclude
}

async function recommendBundle(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
): Promise<RankedRecommendation[]> {
  if (!seed) return []
  const related = await listRelatedProducts(db, input.accountId, seed.id, [
    'bundle',
  ])
  const eligible = related.filter((product) =>
    passesHardFilters(product, seed, requirements, input.shopping, exclude, {
      requireInStock: true,
    }),
  )
  return eligible.slice(0, limit).map((product, index) => ({
    product,
    mode: 'bundle' as const,
    score: 10 - index,
    reasons: ['relation_bundle' as const],
  }))
}

async function recommendCrossSell(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
): Promise<RankedRecommendation[]> {
  if (!seed) return []
  const related = await listRelatedProducts(db, input.accountId, seed.id, [
    'cross_sell',
  ])
  const relatedIds = new Set(related.map((product) => product.id))
  const extras = await retrieveCrossSellExtras(db, input, seed)
  const seen = new Set<string>()
  const candidates: CatalogProduct[] = []
  for (const product of [...related, ...extras]) {
    if (seen.has(product.id)) continue
    seen.add(product.id)
    candidates.push(product)
    if (candidates.length >= CANDIDATE_CAP) break
  }

  const ranked: RankedRecommendation[] = []
  for (const product of candidates) {
    if (
      !passesHardFilters(product, seed, requirements, input.shopping, exclude, {
        requireInStock: true,
      })
    ) {
      continue
    }
    const fromRelation = relatedIds.has(product.id)
    if (!fromRelation && isSubstitute(seed, product)) continue
    ranked.push(scoreCrossSell(seed, product, relatedIds, requirements))
  }
  return ranked
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || comparePrice(a.product, b.product))
    .slice(0, limit)
}

async function retrieveCrossSellExtras(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct,
): Promise<CatalogProduct[]> {
  const extras: CatalogProduct[] = []
  const collectionId = seed.collections?.[0]?.id
  if (collectionId) {
    try {
      const sameCollection = await searchCatalog(db, {
        accountId: input.accountId,
        status: 'active',
        inStock: true,
        limit: CANDIDATE_CAP,
      })
      extras.push(
        ...sameCollection.filter((product) =>
          (product.collections ?? []).some((col) => col.id === collectionId),
        ),
      )
    } catch {
      // lexical fill is optional
    }
  }
  try {
    const hybrid = await loadCatalogHybridMode(db, input.accountId)
    if (hybrid === 'on') {
      const key = await resolveCatalogEmbeddingsKey(db, input.accountId)
      const ids = await semanticNeighborsForProduct(db, input.accountId, seed.id, key)
      if (ids.length > 0) {
        extras.push(...(await getCatalogProductsByIds(db, input.accountId, ids)))
      }
    }
  } catch {
    // semantic failure → lexical / relations only
  }
  return extras
}

function scoreCrossSell(
  seed: CatalogProduct,
  product: CatalogProduct,
  relatedIds: Set<string>,
  requirements: ShoppingRequirements,
): RankedRecommendation {
  let score = 0
  const reasons: RecommendReason[] = []
  if (relatedIds.has(product.id)) {
    score += 6
    reasons.push('relation_cross_sell')
    reasons.push('complements_selected_product')
  }
  if (sharedCollections(seed, product) && !isSubstitute(seed, product)) {
    score += 3
    reasons.push('same_collection')
  }
  if (sharedOccasion(seed, product)) {
    score += 2
    reasons.push('same_occasion')
  }
  if (withinBudget(product, requirements)) {
    score += 1
    reasons.push('within_budget')
  }
  return { product, mode: 'cross_sell', score, reasons }
}

async function recommendUpsell(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
): Promise<RankedRecommendation[]> {
  if (!seed) return []
  const relatedIds = await relatedIdsFor(db, input.accountId, seed.id, ['upsell'])
  const ranked = await findSimilarProducts(db, {
    accountId: input.accountId,
    seed,
    limit: CANDIDATE_CAP,
    shopName: input.shopName,
    requirements,
    relatedIds,
    intent: 'upsell',
  })
  return ranked
    .filter((row) =>
      passesHardFilters(row.product, seed, requirements, input.shopping, exclude, {
        requireInStock: true,
        requireModestStepUp: true,
      }),
    )
    .slice(0, limit)
    .map((row) => ({
      product: row.product,
      mode: 'upsell' as const,
      score: row.score,
      reasons: uniqueReasons([
        ...row.reasons,
        ...(relatedIds.has(row.product.id) ? (['relation_upsell'] as const) : []),
        ...(withinBudget(row.product, requirements) ? (['within_budget'] as const) : []),
      ]),
    }))
}

async function recommendAlternative(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
): Promise<RankedRecommendation[]> {
  if (!seed) {
    return recommendFromSearch(db, input, requirements, exclude, limit, 'alternative')
  }
  const relatedIds = await relatedIdsFor(db, input.accountId, seed.id, ['similar'])
  const intent = requirements.cheaper ? 'cheaper' : 'alternative'
  const ranked = await findAlternativeProducts(db, {
    accountId: input.accountId,
    seed,
    limit: CANDIDATE_CAP,
    shopName: input.shopName,
    requirements,
    relatedIds,
    intent,
  })
  return ranked
    .filter((row) =>
      passesHardFilters(row.product, seed, requirements, input.shopping, exclude, {
        requireInStock: true,
        requireCheaper: Boolean(requirements.cheaper),
        requireStatedOption: true,
        requireStatedAttribute: true,
      }),
    )
    .slice(0, limit)
    .map((row) => ({
      product: row.product,
      mode: 'alternative' as const,
      score: row.score,
      reasons: row.reasons,
    }))
}

async function recommendSimilar(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
): Promise<RankedRecommendation[]> {
  if (!seed) {
    return recommendFromSearch(db, input, requirements, exclude, limit, input.mode)
  }
  const relatedIds = await relatedIdsFor(db, input.accountId, seed.id, ['similar'])
  const ranked = await findSimilarProducts(db, {
    accountId: input.accountId,
    seed,
    limit: CANDIDATE_CAP,
    shopName: input.shopName,
    requirements,
    relatedIds,
    intent: 'similar',
  })
  return ranked
    .filter((row) =>
      passesHardFilters(row.product, seed, requirements, input.shopping, exclude, {
        requireInStock: true,
        requireStatedOption: true,
        requireStatedAttribute: true,
      }),
    )
    .slice(0, limit)
    .map((row) => ({
      product: row.product,
      mode: input.mode,
      score: row.score,
      reasons: uniqueReasons([
        ...row.reasons,
        ...(seedVariantMatch(seed, requirements) ? (['seed_variant'] as const) : []),
      ]),
    }))
}

async function recommendFromSearch(
  db: SupabaseClient,
  input: GetRecommendationsInput,
  requirements: ShoppingRequirements,
  exclude: Set<string>,
  limit: number,
  mode: RecommendIntent,
): Promise<RankedRecommendation[]> {
  const text = [
    input.customerText,
    input.shopping?.categoryHint,
    input.shopping?.occasion,
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
  const products = await searchCatalog(db, {
    accountId: input.accountId,
    text: text || undefined,
    status: 'active',
    inStock: true,
    priceMin: requirements.minPrice,
    priceMax: requirements.maxPrice,
    option:
      requirements.optionName && requirements.optionValue
        ? { name: requirements.optionName, value: requirements.optionValue }
        : undefined,
    limit: CANDIDATE_CAP,
  })
  return products
    .filter((product) =>
      passesHardFilters(product, null, requirements, input.shopping, exclude, {
        requireInStock: true,
        requireStatedOption: true,
        requireStatedAttribute: true,
      }),
    )
    .slice(0, limit)
    .map((product, index) => ({
      product,
      mode,
      score: limit - index,
      reasons: withinBudget(product, requirements) ? ['within_budget'] : [],
    }))
}

function passesHardFilters(
  product: CatalogProduct,
  seed: CatalogProduct | null,
  requirements: ShoppingRequirements,
  shopping: ShoppingContext | undefined,
  exclude: Set<string>,
  opts: {
    requireInStock: boolean
    requireModestStepUp?: boolean
    requireCheaper?: boolean
    requireStatedOption?: boolean
    requireStatedAttribute?: boolean
  },
): boolean {
  if (exclude.has(product.id)) return false
  if (product.status !== 'active') return false
  if (opts.requireInStock && !product.variants.some((variant) => variant.available)) {
    return false
  }
  const [filtered] = applyCatalogHardFilters([product], {
    accountId: product.accountId,
    status: 'active',
    inStock: opts.requireInStock,
    priceMin: requirements.minPrice,
    priceMax: requirements.maxPrice,
    option:
      opts.requireStatedOption &&
      requirements.optionName &&
      requirements.optionValue
        ? {
            name: requirements.optionName,
            value: requirements.optionValue,
          }
        : undefined,
    attribute:
      opts.requireStatedAttribute &&
      requirements.attributeKey &&
      requirements.attributeValue
        ? {
            key: requirements.attributeKey,
            value: requirements.attributeValue,
          }
        : undefined,
  })
  if (!filtered) return false
  if (
    opts.requireStatedOption &&
    requirements.optionValue &&
    !hasAvailableOption(product, requirements.optionName, requirements.optionValue)
  ) {
    return false
  }
  if (opts.requireModestStepUp && !isModestStepUp(seed?.priceMin, product.priceMin)) {
    return false
  }
  if (
    opts.requireCheaper &&
    (seed?.priceMin == null ||
      product.priceMax == null ||
      product.priceMax >= seed.priceMin)
  ) {
    return false
  }
  if (hitsDislike(product, shopping?.dislikes ?? [])) return false
  return true
}

function hitsDislike(product: CatalogProduct, dislikes: string[]): boolean {
  if (dislikes.length === 0) return false
  const hay = [
    product.title,
    product.handle,
    product.description,
    ...product.variants.flatMap((variant) =>
      variant.options.map((opt) => `${opt.name} ${opt.value}`),
    ),
    ...(product.attributes ?? []).map((attr) => `${attr.key} ${attr.value}`),
  ]
    .join(' ')
    .toLowerCase()
  return dislikes.some((dislike) => hay.includes(dislike.toLowerCase()))
}

export function isSubstitute(seed: CatalogProduct, product: CatalogProduct): boolean {
  if (nearDuplicateTitle(seed.title, product.title)) return true
  const typeA = inferProductType(seed)
  const typeB = inferProductType(product)
  return Boolean(typeA && typeB && typeA === typeB)
}

function nearDuplicateTitle(a: string, b: string): boolean {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.length === 0 || tb.length === 0) return false
  const setB = new Set(tb)
  const overlap = ta.filter((token) => setB.has(token)).length
  const union = new Set([...ta, ...tb]).size
  return overlap / union >= 0.6
}

function inferProductType(product: CatalogProduct): string | null {
  const hay = `${product.title} ${product.handle} ${product.description}`.toLowerCase()
  for (const type of PRODUCT_TYPES) {
    if (!new RegExp(`\\b${type}s?\\b`).test(hay)) continue
    if (type === 'sari') return 'saree'
    if (
      type === 'tote' ||
      type === 'backpack' ||
      type === 'clutch' ||
      type === 'pouch'
    ) {
      return 'bag'
    }
    return type
  }
  return null
}

function tokenize(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function sharedCollections(seed: CatalogProduct, product: CatalogProduct): boolean {
  const seedIds = new Set((seed.collections ?? []).map((col) => col.id))
  return (product.collections ?? []).some((col) => seedIds.has(col.id))
}

function sharedOccasion(seed: CatalogProduct, product: CatalogProduct): boolean {
  const seedOcc = (seed.attributes ?? []).filter((attr) =>
    /occasion|use|event/i.test(attr.key),
  )
  if (seedOcc.length === 0) return false
  const values = new Set(seedOcc.map((attr) => attr.value.toLowerCase()))
  return (product.attributes ?? []).some(
    (attr) =>
      /occasion|use|event/i.test(attr.key) && values.has(attr.value.toLowerCase()),
  )
}

function withinBudget(
  product: CatalogProduct,
  requirements: ShoppingRequirements,
): boolean {
  if (requirements.maxPrice == null) return false
  const price = product.priceMin ?? product.priceMax
  return price != null && price <= requirements.maxPrice
}

function seedVariantMatch(
  seed: CatalogProduct,
  requirements: ShoppingRequirements,
): boolean {
  if (!requirements.optionValue) return false
  return hasAvailableOption(seed, requirements.optionName, requirements.optionValue)
}

function mergeRequirements(
  requirements: ShoppingRequirements,
  shopping?: ShoppingContext,
): ShoppingRequirements {
  return {
    minPrice: requirements.minPrice ?? shopping?.minPrice,
    maxPrice: requirements.maxPrice ?? shopping?.maxPrice,
    cheaper: requirements.cheaper,
    optionName: requirements.optionName ?? shopping?.option?.name,
    optionValue: requirements.optionValue ?? shopping?.option?.value,
    attributeKey: requirements.attributeKey,
    attributeValue: requirements.attributeValue,
  }
}

function comparePrice(a: CatalogProduct, b: CatalogProduct): number {
  return (a.priceMin ?? Number.POSITIVE_INFINITY) - (b.priceMin ?? Number.POSITIVE_INFINITY)
}

function uniqueReasons(reasons: RecommendReason[]): RecommendReason[] {
  return [...new Set(reasons)]
}

async function loadPaidRetailerIds(
  db: SupabaseClient,
  accountId: string,
  contactId?: string | null,
): Promise<{ paid: string[]; pending: string[]; hasPaid: boolean; hasCheckout: boolean }> {
  const empty = { paid: [] as string[], pending: [] as string[], hasPaid: false, hasCheckout: false }
  if (!contactId) return empty
  try {
    const { data, error } = await db
      .from('whatsapp_commerce_orders')
      .select('status, payment_id, awaiting_address, line_items')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(8)
    if (error || !Array.isArray(data)) return empty
    const paid: string[] = []
    const pending: string[] = []
    let hasPaid = false
    let hasCheckout = false
    for (const row of data as {
      status?: string
      payment_id?: string | null
      awaiting_address?: boolean
      line_items?: unknown
    }[]) {
      const ids = retailerIdsFromLines(row.line_items)
      const paidOrder =
        Boolean(row.payment_id) ||
        row.status === 'processing' ||
        row.status === 'partially_shipped' ||
        row.status === 'shipped' ||
        row.status === 'completed'
      if (paidOrder) {
        hasPaid = true
        paid.push(...ids)
      }
      if (row.status === 'pending' || row.awaiting_address) {
        hasCheckout = true
        pending.push(...ids)
      }
    }
    return { paid, pending, hasPaid, hasCheckout }
  } catch {
    return empty
  }
}

function retailerIdsFromLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const row = item as Record<string, unknown>
      const id = row.retailer_id ?? row.product_retailer_id
      return typeof id === 'string' ? id.trim() : ''
    })
    .filter(Boolean)
}

async function mapRetailerIds(
  db: SupabaseClient,
  accountId: string,
  retailerIds: string[],
): Promise<string[]> {
  const out: string[] = []
  for (const id of [...new Set(retailerIds.filter(Boolean))]) {
    const product = await lookupCatalogProduct(db, accountId, id)
    if (product) out.push(product.id)
  }
  return out
}

export async function loadCommerceRecommendSignals(
  db: SupabaseClient,
  accountId: string,
  contactId?: string | null,
): Promise<{
  cartRetailerIds: string[]
  paidRetailerIds: string[]
  hasCart: boolean
  hasPendingCheckout: boolean
  hasPaidOrder: boolean
}> {
  const signals = await loadPaidRetailerIds(db, accountId, contactId)
  return {
    cartRetailerIds: signals.pending,
    paidRetailerIds: signals.paid,
    hasCart: signals.pending.length > 0,
    hasPendingCheckout: signals.hasCheckout,
    hasPaidOrder: signals.hasPaid,
  }
}
