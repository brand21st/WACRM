import { describe, expect, it } from 'vitest'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'
import { summarizeProduct } from './tools'
import {
  formatAvailabilityLine,
  formatCurrentProductFacts,
  resolveStructuredMaterial,
} from './product-facts'

function variant(
  id: string,
  color: string | null,
  size: string | null,
  available = true,
): ShopifyVariantHit {
  const options: { name: string; value: string }[] = []
  if (color) options.push({ name: 'Color', value: color })
  if (size) options.push({ name: 'Size', value: size })
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    variantId: id,
    title: [color, size].filter(Boolean).join(' / ') || 'Default Title',
    sku: `SKU-${id}`,
    price: '499',
    compareAtPrice: null,
    available,
    options,
  }
}

function product(
  variants: ShopifyVariantHit[],
  extras: Partial<ShopifyProductHit> = {},
): ShopifyProductHit {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'ag2660',
    title: 'Rayon Side slit Coord sets AG2660',
    description: '<p>Soft rayon co-ord with a side slit.</p>',
    imageUrl: 'https://cdn.example/p.jpg',
    productUrl: 'https://shop.example/products/ag2660',
    cartUrl: 'https://shop.example/cart/1:1',
    checkoutUrl: 'https://shop.example/cart/1:1?checkout',
    priceMin: '1499',
    priceMax: '1499',
    currency: 'INR',
    variants,
    ...extras,
  }
}

const STOCKED = product([
  variant('11', 'Red', 'M'),
  variant('12', 'Red', 'L'),
  variant('13', 'Blue', 'M'),
  variant('14', 'Blue', 'L', false),
])

describe('formatAvailabilityLine', () => {
  it('says in stock when every variant is available', () => {
    const allIn = product([variant('1', 'Red', 'M'), variant('2', 'Blue', 'L')])
    expect(formatAvailabilityLine(allIn)).toBe('in stock')
  })

  it('says out of stock when no variant is available', () => {
    const oos = product([
      variant('1', 'Red', 'M', false),
      variant('2', 'Blue', 'L', false),
    ])
    expect(formatAvailabilityLine(oos)).toBe('out of stock')
  })

  it('lists remaining in-stock colors and sizes when some variants are out', () => {
    const line = formatAvailabilityLine(STOCKED)
    expect(line).toMatch(/some variants in stock/)
    expect(line).toMatch(/Red/)
    expect(line).toMatch(/Blue/)
    expect(line).toMatch(/M/)
  })

  it('names real alternatives when a named combo is out of stock', () => {
    const line = formatAvailabilityLine(STOCKED, { color: 'Blue', size: 'L' })
    expect(line).toMatch(/Blue \/ L is out of stock/)
    expect(line).toMatch(/M/)
    expect(line).not.toMatch(/unknown/)
  })

  it('does not ask size when only one size remains for the chosen color', () => {
    const line = formatAvailabilityLine(STOCKED, { color: 'Blue' })
    expect(line).toMatch(/only size M remains/)
    const facts = formatCurrentProductFacts(STOCKED, { color: 'Blue' })
    expect(facts).toMatch(/ask_size: no/)
  })

  it('skips size and color questions for a no-option product', () => {
    const plain = product([variant('9', null, null)])
    const facts = formatCurrentProductFacts(plain)
    expect(facts).toMatch(/has_color_options: no/)
    expect(facts).toMatch(/has_size_options: no/)
    expect(facts).toMatch(/ask_color: no/)
    expect(facts).toMatch(/ask_size: no/)
    expect(formatAvailabilityLine(plain)).toBe('in stock')
  })

  it('marks availability unknown only when there is no stock signal', () => {
    const unknown = product([], { checkoutUrl: null, cartUrl: null })
    expect(formatAvailabilityLine(unknown)).toMatch(/unknown/)
    expect(formatAvailabilityLine(STOCKED)).not.toMatch(/unknown/)
  })
})

describe('formatCurrentProductFacts', () => {
  it('uses catalog attributes for material and keeps a description excerpt', () => {
    const hit = product(STOCKED.variants, {
      attributes: [{ key: 'material', label: 'Material', value: 'Rayon' }],
    })
    const facts = formatCurrentProductFacts(hit)
    expect(facts).toMatch(/material: Rayon/)
    expect(facts).toMatch(/material_known: yes/)
    expect(facts).toMatch(/attribute_material: Rayon/)
    expect(facts).toMatch(/description_excerpt: Soft rayon co-ord/)
    expect(facts).toMatch(/availability: some variants in stock/)
    expect(facts).not.toMatch(/unknown — no trustworthy stock/)
  })

  it('canonicalizes fabric as material for AG2660-style products', () => {
    const hit = product(STOCKED.variants, {
      attributes: [
        { key: 'color', label: 'Color', value: 'Red' },
        { key: 'fabric', label: 'Fabric', value: 'Rayon' },
        { key: 'size', label: 'Size', value: 'M' },
      ],
    })
    expect(resolveStructuredMaterial(hit)).toEqual({
      value: 'Rayon',
      sourceKey: 'fabric',
    })
    const facts = formatCurrentProductFacts(hit)
    expect(facts).toMatch(/material: Rayon/)
    expect(facts).toMatch(/material_known: yes/)
    expect(facts).toMatch(/material_source_attribute: fabric/)
  })

  it('says material is unavailable when no fabric or material attribute exists', () => {
    const hit = product(STOCKED.variants, {
      title: 'Vatican Silk Coord set AG2668',
      description: 'MATERIAL : Vatican silk with foil print TYPE : Aline',
      attributes: [
        { key: 'color', label: 'Color', value: 'Black' },
        { key: 'size', label: 'Size', value: 'L' },
      ],
    })
    expect(resolveStructuredMaterial(hit)).toBeNull()
    const facts = formatCurrentProductFacts(hit)
    expect(facts).toMatch(/material: unavailable/)
    expect(facts).toMatch(/material_known: no/)
    expect(facts).not.toMatch(/material: Vatican/)
    expect(facts).toMatch(/If material_known is no, say material information is unavailable/)
  })

  it('prefers the structured material over a misleading Linen title', () => {
    const hit = product(STOCKED.variants, {
      title: 'Royal Crest Premium Linen',
      handle: 'royal-crest-premium-linen',
      description: 'Looks like linen. TYPE : Aline kurti.',
      attributes: [
        { key: 'material', label: 'Material', value: 'Premium Cotton Duck' },
      ],
    })
    const facts = formatCurrentProductFacts(hit)
    expect(facts).toMatch(/material: Premium Cotton Duck/)
    expect(facts).toMatch(/material_known: yes/)
    expect(facts).not.toMatch(/material: .*Linen/)
    expect(facts).toMatch(/Words like Linen, Silk, or Premium in the title are not material facts/)
  })

  it('prefers material over fabric when both exist', () => {
    const hit = product(STOCKED.variants, {
      attributes: [
        { key: 'fabric', label: 'Fabric', value: 'Rayon' },
        { key: 'material', label: 'Material', value: 'Premium Cotton Duck' },
      ],
    })
    expect(resolveStructuredMaterial(hit)?.value).toBe('Premium Cotton Duck')
  })
})

describe('summarizeProduct', () => {
  it('keeps description excerpt, attributes, and in-stock option lists', () => {
    const hit = product(STOCKED.variants, {
      attributes: [{ key: 'material', label: 'Material', value: 'Rayon' }],
    })
    const summary = summarizeProduct(hit)
    expect(summary.description_excerpt).toMatch(/Soft rayon co-ord/)
    expect(summary.attributes).toEqual([
      { key: 'material', label: 'Material', value: 'Rayon' },
    ])
    expect(summary.available).toBe(true)
    expect(summary.in_stock_colors).toEqual(['Red', 'Blue'])
    expect(summary.in_stock_sizes).toEqual(['M', 'L'])
  })
})
