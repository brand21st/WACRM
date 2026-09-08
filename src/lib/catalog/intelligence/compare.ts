import type { SupabaseClient } from '@supabase/supabase-js'
import { searchHybridCatalog } from '../search/hybrid'
import { lookupCatalogProduct } from '../search/lookup'
import type { CatalogProduct } from '../core/types'
import { attachCatalogFacts, logCatalogIntel } from './facts'
import {
  COMPARE_CAP,
  UNAVAILABLE,
  type CatalogComparison,
  type CompareCatalogResult,
  type ComparisonRow,
} from './types'

export async function compareCatalogProducts(
  db: SupabaseClient,
  accountId: string,
  ids: string[],
  query?: string,
): Promise<CompareCatalogResult> {
  const requested = unique(ids.map((id) => id.trim()).filter(Boolean))
  const resolved: CatalogProduct[] = []
  const seen = new Set<string>()

  for (const id of requested) {
    if (resolved.length >= COMPARE_CAP) break
    const product = await lookupCatalogProduct(db, accountId, id)
    if (!product || seen.has(product.id)) continue
    seen.add(product.id)
    resolved.push(product)
  }

  if (resolved.length < 2 && query?.trim()) {
    const parts = query
      .split(/\b(?:vs\.?|versus|and|or|,)\b/i)
      .map((part) => part.trim())
      .filter(Boolean)
    const searches = parts.length > 1 ? parts : [query]
    for (const text of searches) {
      if (resolved.length >= COMPARE_CAP) break
      const hits = await searchHybridCatalog(db, {
        accountId,
        text,
        status: 'active',
        limit: COMPARE_CAP,
      })
      for (const hit of hits) {
        if (resolved.length >= COMPARE_CAP) break
        if (seen.has(hit.id)) continue
        seen.add(hit.id)
        resolved.push(hit)
      }
    }
  }

  const omitted = requested.length > COMPARE_CAP
  const products = await attachCatalogFacts(
    db,
    accountId,
    resolved.slice(0, COMPARE_CAP),
  )
  logCatalogIntel({
    accountId,
    tool: 'compare',
    count: products.length,
    extra: { requested: requested.length },
  })

  if (products.length < 2) {
    return {
      products,
      comparison: {
        productIds: products.map((product) => product.id),
        rows: [],
        notes: [
          'Need two catalog products to compare. Do not invent a pair.',
        ],
      },
    }
  }

  const notes: string[] = []
  if (omitted) {
    notes.push(`Compared the first ${COMPARE_CAP} products only.`)
  }
  return {
    products,
    comparison: buildComparison(products, notes),
  }
}

export function buildComparison(
  products: CatalogProduct[],
  extraNotes: string[] = [],
): CatalogComparison {
  const notes = [...extraNotes]
  const rows: ComparisonRow[] = [
    fieldRow('title', products, (product) => product.title),
    fieldRow('price', products, formatPrice),
    fieldRow('compare_at', products, formatCompareAt),
    fieldRow('availability', products, formatAvailability),
    fieldRow('brand', products, (product) => product.brand?.trim() || null),
    fieldRow('variants', products, (product) => String(product.variants.length)),
    fieldRow('collections', products, formatCollections),
  ]

  const optionNames = union(
    products.flatMap((product) =>
      product.variants.flatMap((variant) =>
        variant.options.map((opt) => opt.name.trim()).filter(Boolean),
      ),
    ),
  )
  for (const name of optionNames) {
    rows.push(
      fieldRow(`option:${name}`, products, (product) =>
        unique(
          product.variants.flatMap((variant) =>
            variant.options
              .filter((opt) => opt.name.trim().toLowerCase() === name.toLowerCase())
              .map((opt) => opt.value),
          ),
        ).join(', ') || null,
      ),
    )
  }

  const attributeKeys = union(
    products.flatMap((product) =>
      (product.attributes ?? []).map((attr) => attr.key.trim()).filter(Boolean),
    ),
  )
  for (const key of attributeKeys) {
    const label =
      products
        .flatMap((product) => product.attributes ?? [])
        .find((attr) => attr.key === key)?.label ?? key
    rows.push(
      fieldRow(`attribute:${label}`, products, (product) => {
        const values = unique(
          (product.attributes ?? [])
            .filter((attr) => attr.key === key)
            .map((attr) => attr.value),
        )
        return values.join(', ') || null
      }),
    )
  }

  for (const row of rows) {
    row.values.forEach((value, index) => {
      if (value != null && value !== UNAVAILABLE) return
      const title = products[index]?.title ?? `Product ${index + 1}`
      if (row.field.startsWith('attribute:')) {
        notes.push(`${title} has no ${row.field.slice('attribute:'.length)} attribute.`)
      }
    })
  }

  return {
    productIds: products.map((product) => product.id),
    rows,
    notes: unique(notes),
  }
}

function fieldRow(
  field: string,
  products: CatalogProduct[],
  read: (product: CatalogProduct) => string | null,
): ComparisonRow {
  return {
    field,
    values: products.map((product) => {
      const value = read(product)
      return value == null || value === '' ? UNAVAILABLE : value
    }),
  }
}

function formatPrice(product: CatalogProduct): string | null {
  if (product.priceMin == null && product.priceMax == null) return null
  const currency = product.currency ?? ''
  if (
    product.priceMin != null &&
    product.priceMax != null &&
    product.priceMin !== product.priceMax
  ) {
    return `${currency} ${product.priceMin} – ${product.priceMax}`.trim()
  }
  return `${currency} ${product.priceMin ?? product.priceMax}`.trim()
}

function formatCompareAt(product: CatalogProduct): string | null {
  const values = unique(
    product.variants
      .map((variant) => variant.compareAtPrice)
      .filter((price): price is number => price != null)
      .map(String),
  )
  return values.length > 0 ? values.join(', ') : null
}

function formatAvailability(product: CatalogProduct): string {
  const inStock = product.variants.some((variant) => variant.available)
  return inStock ? 'in stock' : 'unavailable'
}

function formatCollections(product: CatalogProduct): string | null {
  const titles = (product.collections ?? []).map((col) => col.title).filter(Boolean)
  return titles.length > 0 ? titles.join(', ') : null
}

function union(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}
