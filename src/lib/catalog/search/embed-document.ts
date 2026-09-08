import { createHash } from 'node:crypto'
import type { CatalogProduct } from '../core/types'

export const CATALOG_EMBEDDING_MODEL = 'text-embedding-3-small'
export const CATALOG_EMBEDDING_DIMENSIONS = 1536

export function buildCatalogEmbedDocument(
  product: CatalogProduct,
  shopName?: string | null,
): string {
  const lines: string[] = [product.title.trim(), product.description.trim()]
  const brand = product.brand?.trim()
  const shop = shopName?.trim()
  if (brand && (!shop || brand.toLowerCase() !== shop.toLowerCase())) {
    lines.push(`brand: ${brand}`)
  }
  const collections = (product.collections ?? [])
    .map((col) => col.title.trim())
    .filter(Boolean)
  if (collections.length > 0) {
    lines.push(`collections: ${unique(collections).join(', ')}`)
  }
  const attributes = (product.attributes ?? [])
    .filter((attr) => attr.key.trim() && attr.value.trim())
    .map((attr) => `${attr.key.trim()}=${attr.value.trim()}`)
  if (attributes.length > 0) {
    lines.push(`attributes: ${unique(attributes).join(', ')}`)
  }
  const optionGroups = new Map<string, Set<string>>()
  for (const variant of product.variants) {
    for (const opt of variant.options) {
      const name = opt.name.trim()
      const value = opt.value.trim()
      if (!name || !value) continue
      const set = optionGroups.get(name) ?? new Set<string>()
      set.add(value)
      optionGroups.set(name, set)
    }
  }
  if (optionGroups.size > 0) {
    const options = [...optionGroups.entries()]
      .map(([name, values]) => `${name}=${[...values].join(', ')}`)
      .join('; ')
    lines.push(`options: ${options}`)
  }
  return lines.filter(Boolean).join('\n')
}

export function hashCatalogEmbedDocument(document: string): string {
  return createHash('sha256').update(document).digest('hex')
}

function unique(values: string[]): string[] {
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
