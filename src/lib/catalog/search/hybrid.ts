import type { SupabaseClient } from '@supabase/supabase-js'
import type { CatalogProduct, CatalogSearchQuery } from '../core/types'
import { getCatalogProductsByIds } from '../intelligence/facts'
import { lookupCatalogProduct } from './lookup'
import { catalogSearchFetchLimit, logCatalogSearch, searchCatalog } from './query'
import {
  type CatalogHybridMode,
  countReadyCatalogEmbeddings,
  loadCatalogHybridMode,
  matchCatalogSemantic,
  resolveCatalogEmbeddingsKey,
  SEMANTIC_CANDIDATE_CAP,
} from './semantic'

const RRF_K = 60

export type HybridSearchOpts = {
  mode?: CatalogHybridMode
  embeddingsApiKey?: string | null
  semanticSearch?: (
    db: SupabaseClient,
    accountId: string,
    query: string,
    embeddingsApiKey: string,
    limit?: number,
  ) => Promise<string[]>
}

export async function searchHybridCatalog(
  db: SupabaseClient,
  query: CatalogSearchQuery,
  opts?: HybridSearchOpts,
): Promise<CatalogProduct[]> {
  const started = Date.now()
  const text = (query.text ?? '').trim()
  const fetchLimit = catalogSearchFetchLimit(query.limit)

  if (text) {
    const exact = await tryExactLookup(db, query.accountId, text)
    if (exact) {
      const filtered = applyCatalogHardFilters([exact], query)
      logCatalogSearch({
        accountId: query.accountId,
        tool: 'searchHybridCatalog',
        latencyMs: Date.now() - started,
        count: filtered.length,
      })
      return filtered.slice(0, query.limit ?? fetchLimit)
    }
  }

  const lexical = await searchCatalog(db, query)
  const mode = opts?.mode ?? (await loadCatalogHybridMode(db, query.accountId))
  if (mode === 'off' || !text) {
    logHybrid(query.accountId, 'lexical', lexical.length, 0, lexical.length, started)
    return lexical
  }

  const key = await resolveCatalogEmbeddingsKey(db, query.accountId, opts?.embeddingsApiKey)
  const ready = key ? await countReadyCatalogEmbeddings(db, query.accountId) : 0
  if (!key || ready === 0) {
    logHybrid(query.accountId, 'lexical', lexical.length, 0, lexical.length, started)
    return lexical
  }

  let semanticIds: string[] = []
  try {
    const search = opts?.semanticSearch ?? matchCatalogSemantic
    semanticIds = await search(db, query.accountId, text, key, SEMANTIC_CANDIDATE_CAP)
  } catch (err) {
    console.warn('[catalog-search] semantic failed', {
      accountId: query.accountId,
      error: err instanceof Error ? err.message : String(err),
    })
  }

  const mergedIds = reciprocalRankFusion(
    lexical.map((product) => product.id),
    semanticIds,
  )
  const extras = mergedIds.filter((id) => !lexical.some((product) => product.id === id))
  const extraProducts =
    extras.length > 0 ? await getCatalogProductsByIds(db, query.accountId, extras) : []
  const byId = new Map<string, CatalogProduct>()
  for (const product of [...lexical, ...extraProducts]) byId.set(product.id, product)
  const hybrid = mergedIds
    .map((id) => byId.get(id))
    .filter((product): product is CatalogProduct => Boolean(product))
  const filtered = applyCatalogHardFilters(hybrid, query).slice(0, fetchLimit)

  logHybrid(
    query.accountId,
    mode === 'shadow' ? 'shadow' : 'hybrid',
    lexical.length,
    semanticIds.length,
    filtered.length,
    started,
    {
      lexicalIds: lexical.map((product) => product.id),
      hybridIds: filtered.map((product) => product.id),
    },
  )

  if (mode === 'shadow') return lexical
  return filtered.slice(0, query.limit ?? fetchLimit)
}

export function reciprocalRankFusion(
  lexicalIds: string[],
  semanticIds: string[],
  k = RRF_K,
): string[] {
  const scores = new Map<string, number>()
  lexicalIds.forEach((id, index) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1))
  })
  semanticIds.forEach((id, index) => {
    scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1))
  })
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([id]) => id)
}

export function applyCatalogHardFilters(
  products: CatalogProduct[],
  query: CatalogSearchQuery,
): CatalogProduct[] {
  return products.filter((product) => {
    if (product.status !== (query.status ?? 'active')) return false
    if (query.inStock && !product.variants.some((variant) => variant.available)) {
      return false
    }
    if (query.priceMin != null || query.priceMax != null) {
      const min = product.priceMin
      const max = product.priceMax
      if (min == null && max == null) return false
      const hi = max ?? min ?? 0
      const lo = min ?? max ?? 0
      if (query.priceMin != null && hi < query.priceMin) return false
      if (query.priceMax != null && lo > query.priceMax) return false
    }
    if (query.option?.name && query.option.value) {
      const name = query.option.name.trim().toLowerCase()
      const value = query.option.value.trim().toLowerCase()
      const matches = product.variants.some((variant) =>
        variant.options.some(
          (opt) =>
            opt.name.toLowerCase() === name && opt.value.toLowerCase() === value,
        ),
      )
      if (!matches) return false
    }
    if (query.attribute?.key && query.attribute.value) {
      const key = query.attribute.key.trim().toLowerCase()
      const value = query.attribute.value.trim().toLowerCase()
      const attrs = product.attributes ?? []
      if (attrs.length === 0) return true
      const hasKey = attrs.some((attr) => attr.key.toLowerCase() === key)
      if (!hasKey) return true
      return attrs.some(
        (attr) => attr.key.toLowerCase() === key && attr.value.toLowerCase() === value,
      )
    }
    if (query.brand) {
      if ((product.brand ?? '').toLowerCase() !== query.brand.trim().toLowerCase()) {
        return false
      }
    }
    if (query.collectionId) {
      const ok = (product.collections ?? []).some((col) => col.id === query.collectionId)
      if (!ok) return false
    }
    return true
  })
}

function looksLikeExactId(text: string): boolean {
  if (!text.trim()) return false
  if (text.startsWith('gid://')) return true
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    return true
  }
  if (/\s/.test(text)) return false
  if (/\d/.test(text)) return true
  return text.includes('-') && text.length >= 5
}

async function tryExactLookup(
  db: SupabaseClient,
  accountId: string,
  text: string,
): Promise<CatalogProduct | null> {
  if (!looksLikeExactId(text)) return null
  return lookupCatalogProduct(db, accountId, text)
}

function logHybrid(
  accountId: string,
  mode: 'lexical' | 'hybrid' | 'shadow',
  lexicalCount: number,
  semanticCount: number,
  hybridCount: number,
  started: number,
  extra?: Record<string, unknown>,
): void {
  console.info('[catalog-search]', {
    accountId,
    tool: 'searchHybridCatalog',
    mode,
    lexicalCount,
    semanticCount,
    hybridCount,
    latencyMs: Date.now() - started,
    ...(hybridCount === 0 ? { empty: true } : {}),
    ...extra,
  })
}
