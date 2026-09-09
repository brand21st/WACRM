import {
  findVariant,
  inStockColors,
  inStockSizes,
  valuesEqual,
} from './match-variant'
import type { ShopifyProductHit } from './types'

const DESCRIPTION_EXCERPT = 220
const FACT_ATTR_KEYS =
  /^(material|fabric|fibre|fiber|composition|fit|occasion|care|wash)$/i

const MATERIAL_ALIAS_RANK: { alias: string; rank: number }[] = [
  { alias: 'material', rank: 0 },
  { alias: 'fabric', rank: 1 },
  { alias: 'fibre', rank: 2 },
  { alias: 'fiber', rank: 3 },
  { alias: 'composition', rank: 4 },
  { alias: 'cloth', rank: 5 },
  { alias: 'textile', rank: 6 },
  { alias: 'fabric_type', rank: 7 },
  { alias: 'material_type', rank: 8 },
]

export type StructuredMaterial = {
  value: string
  sourceKey: string
}

export type ProductFactFocus = {
  color?: string | null
  size?: string | null
  title?: string | null
  handle?: string | null
  variantId?: string | null
} | null

export type AvailabilityOpts = {
  color?: string | null
  size?: string | null
}

export function descriptionExcerpt(
  text: string | null | undefined,
  max = DESCRIPTION_EXCERPT,
): string {
  const plain = (text ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!plain) return ''
  if (plain.length <= max) return plain
  return `${plain.slice(0, max).trim()}…`
}

export function compactAttributes(
  attributes: ShopifyProductHit['attributes'] | undefined,
): { key: string; label: string; value: string }[] {
  if (!attributes?.length) return []
  const seen = new Set<string>()
  const out: { key: string; label: string; value: string }[] = []
  for (const row of attributes) {
    const value = row.value.trim()
    if (!value) continue
    const key = row.key.trim() || row.label.trim()
    const label = row.label.trim() || key
    const id = key.toLowerCase()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ key, label, value })
  }
  return out
}

function normalizeAttrName(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function materialAliasFor(raw: string): { alias: string; rank: number } | null {
  const n = normalizeAttrName(raw)
  if (!n) return null
  for (const row of MATERIAL_ALIAS_RANK) {
    if (n === row.alias) return row
    if (n.endsWith(`.${row.alias}`) || n.endsWith(`_${row.alias}`)) return row
  }
  return null
}

/** Structured material/fabric only. Never reads title, handle, or description. */
export function resolveStructuredMaterial(
  hit: ShopifyProductHit | null | undefined,
): StructuredMaterial | null {
  if (!hit?.attributes?.length) return null
  let best: { value: string; sourceKey: string; rank: number } | null = null
  for (const row of compactAttributes(hit.attributes)) {
    const match = materialAliasFor(row.key) ?? materialAliasFor(row.label)
    if (!match) continue
    if (!best || match.rank < best.rank) {
      best = {
        value: row.value,
        sourceKey: row.key || match.alias,
        rank: match.rank,
      }
    }
  }
  if (!best) return null
  return { value: best.value, sourceKey: best.sourceKey }
}

export function hitAvailabilityKnown(hit: ShopifyProductHit): boolean {
  if (hit.variants.length > 0) return true
  return Boolean(hit.checkoutUrl?.trim())
}

export function hitInStock(hit: ShopifyProductHit): boolean {
  if (hit.variants.length === 0) return Boolean(hit.checkoutUrl?.trim())
  return hit.variants.some((v) => v.available)
}

export function formatAvailabilityLine(
  hit: ShopifyProductHit,
  opts: AvailabilityOpts = {},
): string {
  const color = opts.color?.trim() || null
  const size = opts.size?.trim() || null

  if (!hitAvailabilityKnown(hit)) {
    return 'unknown — no trustworthy stock field on this product'
  }

  if (hit.variants.length === 0) {
    return hitInStock(hit) ? 'in stock' : 'out of stock'
  }

  if (color && size) {
    const variant = findVariant(hit.variants, { color, size })
    if (variant) return `in stock (${color} / ${size})`
    const sizesForColor = inStockSizes(hit.variants, color)
    const colors = inStockColors(hit.variants)
    if (sizesForColor.length > 0) {
      return `${color} / ${size} is out of stock. In-stock sizes for ${color}: ${sizesForColor.join(', ')}`
    }
    if (colors.length > 0) {
      return `${color} / ${size} is out of stock. In-stock colors: ${colors.join(', ')}`
    }
    return `${color} / ${size} is out of stock`
  }

  if (color) {
    const sizesForColor = inStockSizes(hit.variants, color)
    const colors = inStockColors(hit.variants)
    const colorInStock = colors.some((c) => valuesEqual(c, color))
    if (colorInStock) {
      if (sizesForColor.length === 0) return `in stock (${color})`
      if (sizesForColor.length === 1) {
        return `in stock (${color}; only size ${sizesForColor[0]} remains)`
      }
      return `in stock (${color}; sizes ${sizesForColor.join(', ')})`
    }
    if (colors.length > 0) {
      return `${color} is out of stock. In-stock colors: ${colors.join(', ')}`
    }
    return `${color} is out of stock`
  }

  if (size) {
    const colorsForSize = inStockColors(hit.variants, size)
    const sizes = inStockSizes(hit.variants)
    const sizeInStock = sizes.some((s) => valuesEqual(s, size))
    if (sizeInStock) {
      if (colorsForSize.length === 0) return `in stock (size ${size})`
      return `in stock (size ${size}; colors ${colorsForSize.join(', ')})`
    }
    if (sizes.length > 0) {
      return `size ${size} is out of stock. In-stock sizes: ${sizes.join(', ')}`
    }
    return `size ${size} is out of stock`
  }

  const stocked = hit.variants.filter((v) => v.available)
  if (stocked.length === 0) return 'out of stock'
  if (stocked.length < hit.variants.length) {
    const colors = inStockColors(hit.variants)
    const sizes = inStockSizes(hit.variants)
    const bits = ['some variants in stock']
    if (colors.length) bits.push(`colors ${colors.join(', ')}`)
    if (sizes.length) bits.push(`sizes ${sizes.join(', ')}`)
    return bits.join('; ')
  }
  return 'in stock'
}

export function formatCurrentProductFacts(
  hit: ShopifyProductHit | null | undefined,
  focus?: ProductFactFocus,
): string {
  if (!hit) return ''
  const color = focus?.color?.trim() || null
  const size = focus?.size?.trim() || null
  const colors = inStockColors(hit.variants)
  const sizes = color
    ? inStockSizes(hit.variants, color)
    : inStockSizes(hit.variants)
  const hasColor = inStockColors(hit.variants).length > 0
  const hasSize = inStockSizes(hit.variants).length > 0
  const attrs = compactAttributes(hit.attributes)
  const excerpt = descriptionExcerpt(hit.description)
  const price =
    hit.priceMin && hit.priceMax && hit.priceMin !== hit.priceMax
      ? `${hit.priceMin}–${hit.priceMax}${hit.currency ? ` ${hit.currency}` : ''}`
      : `${hit.priceMin ?? hit.priceMax ?? ''}${hit.currency ? ` ${hit.currency}` : ''}`.trim()

  const askColor = hasColor && colors.length > 1
  const askSize = hasSize && sizes.length > 1

  const lines: string[] = [
    'Current product facts (trusted catalog data — answer from these; never invent; do not hedge when a field is present):',
    `title: ${hit.title}`,
  ]
  if (price) lines.push(`price: ${price}`)
  lines.push(`availability: ${formatAvailabilityLine(hit, { color, size })}`)
  if (hasColor) lines.push(`in_stock_colors: ${colors.join(', ') || 'none'}`)
  if (hasSize) lines.push(`in_stock_sizes: ${sizes.join(', ') || 'none'}`)
  lines.push(`has_color_options: ${hasColor ? 'yes' : 'no'}`)
  lines.push(`has_size_options: ${hasSize ? 'yes' : 'no'}`)
  lines.push(
    `ask_color: ${askColor ? 'yes, only if color is still unknown' : 'no'}`,
  )
  lines.push(
    `ask_size: ${askSize ? 'yes, only if size is still unknown' : 'no'}`,
  )
  if (color) lines.push(`selected_color: ${color}`)
  if (size) lines.push(`selected_size: ${size}`)
  const material = resolveStructuredMaterial(hit)
  if (material) {
    lines.push(`material: ${material.value}`)
    lines.push('material_known: yes')
    if (normalizeAttrName(material.sourceKey) !== 'material') {
      lines.push(`material_source_attribute: ${material.sourceKey}`)
    }
  } else {
    lines.push('material: unavailable')
    lines.push('material_known: no')
  }
  for (const attr of attrs) {
    if (!FACT_ATTR_KEYS.test(attr.key) && !FACT_ATTR_KEYS.test(attr.label)) {
      continue
    }
    lines.push(`attribute_${attr.key}: ${attr.value}`)
  }
  if (excerpt) lines.push(`description_excerpt: ${excerpt}`)
  lines.push(
    'When the customer asks material, fabric, or “is it cotton?”, answer from the material line only. ' +
      'If material_known is no, say material information is unavailable. ' +
      'Do not guess fiber from title, handle, description, cut, type, style, or category. ' +
      'Words like Linen, Silk, or Premium in the title are not material facts.',
  )
  return lines.join('\n')
}
