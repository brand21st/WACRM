import { INTERACTIVE_LIMITS } from '@/lib/whatsapp/meta-api'
import type { InteractiveListRow } from '@/lib/whatsapp/interactive'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'

const PLACEHOLDER = /^(default(?: title)?)$/i
const COLOR_NAME = /^colou?r$/i
const SIZE_NAME = /^size$/i

export const VARIANT_COLOR_PREFIX = 'wacrm:color:'
export const VARIANT_SIZE_PREFIX = 'wacrm:size:'

export type VariantPickerKind = 'color' | 'size' | 'done' | 'oos'

export type ParsedVariantPickerAction =
  | { kind: 'color'; handle: string; color: string }
  | { kind: 'size'; handle: string; color: string | null; size: string }

export function inStockVariants(
  variants: ShopifyVariantHit[],
): ShopifyVariantHit[] {
  return variants.filter((v) => v.available)
}

export function optionValue(
  variant: ShopifyVariantHit,
  name: RegExp,
): string {
  const value = variant.options.find((o) => name.test(o.name))?.value.trim() ?? ''
  return value && !PLACEHOLDER.test(value) ? value : ''
}

export function variantColor(variant: ShopifyVariantHit): string {
  return optionValue(variant, COLOR_NAME)
}

export function variantSize(variant: ShopifyVariantHit): string {
  return optionValue(variant, SIZE_NAME)
}

function uniqueValues(
  variants: ShopifyVariantHit[],
  pick: (v: ShopifyVariantHit) => string,
): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const v of variants) {
    const value = pick(v)
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

export function inStockColors(
  variants: ShopifyVariantHit[],
  size?: string | null,
): string[] {
  const stock = inStockVariants(variants).filter((v) =>
    size ? valuesEqual(variantSize(v), size) : true,
  )
  return uniqueValues(stock, variantColor)
}

export function inStockSizes(
  variants: ShopifyVariantHit[],
  color?: string | null,
): string[] {
  const stock = inStockVariants(variants).filter((v) =>
    color ? valuesEqual(variantColor(v), color) : true,
  )
  return uniqueValues(stock, variantSize)
}

export function valuesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function askHasOptionValue(ask: string, value: string): boolean {
  const v = value.trim()
  if (!v || !ask.trim()) return false
  const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, 'iu').test(
    ask,
  )
}

export function inferOptionsFromAsk(
  ask: string | null | undefined,
  variants: ShopifyVariantHit[],
): { color?: string; size?: string } {
  const raw = (ask ?? '').trim()
  if (!raw) return {}
  const colors = uniqueValues(variants, variantColor)
  const sizes = uniqueValues(variants, variantSize)
  const color = matchLongest(raw, colors)
  const size = matchLongest(raw, sizes)
  return { ...(color ? { color } : {}), ...(size ? { size } : {}) }
}

function matchLongest(ask: string, values: string[]): string | undefined {
  return values
    .filter((value) => askHasOptionValue(ask, value))
    .sort((a, b) => b.length - a.length)[0]
}

export function findVariant(
  variants: ShopifyVariantHit[],
  opts: { color?: string | null; size?: string | null },
): ShopifyVariantHit | null {
  const stock = inStockVariants(variants)
  const hits = stock.filter((v) => {
    if (opts.color && !valuesEqual(variantColor(v), opts.color)) return false
    if (opts.size && !valuesEqual(variantSize(v), opts.size)) return false
    return true
  })
  if (hits.length === 1) return hits[0]
  if (hits.length > 1 && !opts.color && !opts.size) return hits[0]
  if (
    hits.length > 1 &&
    ((opts.color && !opts.size && inStockSizes(hits).length === 0) ||
      (opts.size && !opts.color && inStockColors(hits).length === 0))
  ) {
    return hits[0]
  }
  return null
}

export function resolveVariantPicker(args: {
  product: ShopifyProductHit
  ask?: string | null
  chosenColor?: string | null
  chosenSize?: string | null
}): {
  kind: VariantPickerKind
  color?: string
  size?: string
  colors: string[]
  sizes: string[]
  variant: ShopifyVariantHit | null
} {
  const stock = inStockVariants(args.product.variants)
  if (args.product.variants.length === 0) {
    return { kind: 'done', colors: [], sizes: [], variant: null }
  }
  if (stock.length === 0) {
    return { kind: 'oos', colors: [], sizes: [], variant: null }
  }

  const inferred = inferOptionsFromAsk(args.ask, args.product.variants)
  const color = args.chosenColor?.trim() || inferred.color
  const size = args.chosenSize?.trim() || inferred.size
  const colors = inStockColors(args.product.variants, size)
  const sizes = inStockSizes(args.product.variants, color)
  const hasColorOptions = inStockColors(args.product.variants).length > 0
  const hasSizeOptions = inStockSizes(args.product.variants).length > 0

  if (!hasColorOptions && !hasSizeOptions) {
    return {
      kind: 'done',
      colors: [],
      sizes: [],
      variant: stock[0] ?? null,
    }
  }

  if (hasColorOptions && !color) {
    return { kind: 'color', colors, sizes, variant: null }
  }
  if (hasSizeOptions && !size) {
    return { kind: 'size', color, colors, sizes, variant: null }
  }

  const variant = findVariant(args.product.variants, { color, size })
  if (variant) {
    return { kind: 'done', color, size, colors, sizes, variant }
  }
  return { kind: 'oos', color, size, colors, sizes, variant: null }
}

export function parseWacrmAction(text: string): string | null {
  const fromTap = text.match(/\(action:\s*(wacrm:[^)]+)\)/i)
  if (fromTap?.[1]) return fromTap[1].trim()
  const raw = text.trim()
  return raw.startsWith('wacrm:') ? raw : null
}

export function parseVariantPickerAction(
  text: string | null | undefined,
): ParsedVariantPickerAction | null {
  const action = parseWacrmAction(text ?? '')
  if (!action) return null
  if (action.startsWith(VARIANT_COLOR_PREFIX)) {
    const rest = action.slice(VARIANT_COLOR_PREFIX.length)
    const split = rest.indexOf(':')
    if (split <= 0) return null
    const handle = decodePart(rest.slice(0, split))
    const color = decodePart(rest.slice(split + 1))
    if (!handle || !color) return null
    return { kind: 'color', handle, color }
  }
  if (action.startsWith(VARIANT_SIZE_PREFIX)) {
    const rest = action.slice(VARIANT_SIZE_PREFIX.length)
    const first = rest.indexOf(':')
    if (first <= 0) return null
    const handle = decodePart(rest.slice(0, first))
    const after = rest.slice(first + 1)
    const second = after.indexOf(':')
    if (second < 0) return null
    const color = decodePart(after.slice(0, second)) || null
    const size = decodePart(after.slice(second + 1))
    if (!handle || !size) return null
    return { kind: 'size', handle, color, size }
  }
  return null
}

export function colorRowId(handle: string, color: string): string {
  return `${VARIANT_COLOR_PREFIX}${encodePart(handle)}:${encodePart(color)}`
}

export function sizeRowId(
  handle: string,
  color: string | null,
  size: string,
): string {
  return `${VARIANT_SIZE_PREFIX}${encodePart(handle)}:${color ? encodePart(color) : ''}:${encodePart(size)}`
}

export function buildColorPickerRows(
  handle: string,
  colors: string[],
): InteractiveListRow[] {
  return colors.slice(0, INTERACTIVE_LIMITS.maxListRowsTotal).map((color) => ({
    id: colorRowId(handle, color),
    title: clip(color, INTERACTIVE_LIMITS.listRowTitleMaxLength),
  }))
}

export function buildSizePickerRows(
  handle: string,
  color: string | null,
  sizes: { size: string; price?: string | null }[],
): InteractiveListRow[] {
  return sizes.slice(0, INTERACTIVE_LIMITS.maxListRowsTotal).map((row) => ({
    id: sizeRowId(handle, color, row.size),
    title: clip(row.size, INTERACTIVE_LIMITS.listRowTitleMaxLength),
    ...(row.price
      ? {
          description: clip(
            row.price,
            INTERACTIVE_LIMITS.listRowDescriptionMaxLength,
          ),
        }
      : {}),
  }))
}

export function sizeRowsFromProduct(
  product: ShopifyProductHit,
  color?: string | null,
): { size: string; price?: string | null }[] {
  const sizes = inStockSizes(product.variants, color)
  return sizes.map((size) => {
    const hit = findVariant(product.variants, { color, size })
    return { size, price: priceLabel(hit, product) }
  })
}

export function handleFromProductUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const match = url.match(/\/products\/([^/?#]+)/i)
  if (!match?.[1]) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function priceLabel(
  variant: ShopifyVariantHit | null,
  product: ShopifyProductHit,
): string | null {
  const price = variant?.price ?? product.priceMin
  if (!price) return null
  return product.currency ? `${price} ${product.currency}` : price
}

function encodePart(value: string): string {
  return encodeURIComponent(value.trim())
}

function decodePart(value: string): string {
  try {
    return decodeURIComponent(value.trim())
  } catch {
    return value.trim()
  }
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)).trimEnd() + '…'
}
