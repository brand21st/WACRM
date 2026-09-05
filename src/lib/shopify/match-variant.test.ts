import { describe, expect, it } from 'vitest'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'
import {
  buildColorPickerRows,
  buildSizePickerRows,
  colorRowId,
  findVariant,
  inStockColors,
  inStockSizes,
  inferOptionsFromAsk,
  parseVariantPickerAction,
  resolveVariantPicker,
  sizeRowId,
} from './match-variant'

function variant(
  id: string,
  color: string | null,
  size: string | null,
  available = true,
  price = '499',
): ShopifyVariantHit {
  const options: { name: string; value: string }[] = []
  if (color) options.push({ name: 'Color', value: color })
  if (size) options.push({ name: 'Size', value: size })
  return {
    id: `gid://shopify/ProductVariant/${id}`,
    variantId: id,
    title: [color, size].filter(Boolean).join(' / ') || 'Default Title',
    sku: `SKU-${id}`,
    price,
    compareAtPrice: null,
    available,
    options,
  }
}

function product(variants: ShopifyVariantHit[]): ShopifyProductHit {
  return {
    id: 'gid://shopify/Product/1',
    handle: 'pournami-red',
    title: 'Pournami',
    description: '',
    imageUrl: 'https://cdn.example/p.jpg',
    productUrl: 'https://shop.example/products/pournami-red',
    cartUrl: 'https://shop.example/cart/1:1',
    checkoutUrl: 'https://shop.example/cart/1:1?checkout',
    priceMin: '499',
    priceMax: '699',
    currency: 'INR',
    variants,
  }
}

const STOCKED = product([
  variant('11', 'Red', 'M'),
  variant('12', 'Red', 'L'),
  variant('13', 'Blue', 'M'),
  variant('14', 'Blue', 'L', false),
])

describe('in-stock option lists', () => {
  it('omits out-of-stock colors and sizes', () => {
    expect(inStockColors(STOCKED.variants)).toEqual(['Red', 'Blue'])
    expect(inStockSizes(STOCKED.variants, 'Blue')).toEqual(['M'])
    expect(inStockSizes(STOCKED.variants, 'Red')).toEqual(['M', 'L'])
  })

  it('does not list Blue as a size option when Blue / L is out of stock and M is the only in-stock Blue', () => {
    expect(inStockColors(STOCKED.variants, 'L')).toEqual(['Red'])
  })
})

describe('inferOptionsFromAsk', () => {
  it('reads color and size from the customer text', () => {
    expect(inferOptionsFromAsk('Pournami Red size M', STOCKED.variants)).toEqual({
      color: 'Red',
      size: 'M',
    })
  })

  it('does not treat a lone letter inside another word as a size', () => {
    expect(inferOptionsFromAsk('am looking', STOCKED.variants)).toEqual({})
  })
})

describe('resolveVariantPicker', () => {
  it('asks for color first when nothing is chosen', () => {
    const next = resolveVariantPicker({ product: STOCKED, ask: 'Pournami' })
    expect(next.kind).toBe('color')
    expect(next.colors).toEqual(['Red', 'Blue'])
  })

  it('skips to size when the ask already names a color', () => {
    const next = resolveVariantPicker({ product: STOCKED, ask: 'red bag' })
    expect(next.kind).toBe('size')
    expect(next.color).toBe('Red')
    expect(next.sizes).toEqual(['M', 'L'])
  })

  it('is done when color and size match an in-stock variant', () => {
    const next = resolveVariantPicker({
      product: STOCKED,
      ask: 'red size M',
    })
    expect(next.kind).toBe('done')
    expect(next.variant?.variantId).toBe('11')
  })

  it('is out of stock when the named combo is unavailable', () => {
    const next = resolveVariantPicker({
      product: STOCKED,
      ask: 'Blue L',
    })
    expect(next.kind).toBe('oos')
  })

  it('skips pickers when the product has no variant records', () => {
    const next = resolveVariantPicker({
      product: product([]),
      ask: 'this bag',
    })
    expect(next.kind).toBe('done')
    expect(next.variant).toBeNull()
  })

  it('skips pickers for a default-title product', () => {
    const next = resolveVariantPicker({
      product: product([variant('9', null, null)]),
      ask: 'this one',
    })
    expect(next.kind).toBe('done')
    expect(next.variant?.variantId).toBe('9')
  })
})

describe('findVariant', () => {
  it('returns the exact in-stock color and size', () => {
    expect(findVariant(STOCKED.variants, { color: 'Red', size: 'L' })?.variantId).toBe(
      '12',
    )
  })
})

describe('picker row ids', () => {
  it('round-trips color and size actions', () => {
    const colorId = colorRowId('pournami-red', 'Navy Blue')
    expect(parseVariantPickerAction(`(action: ${colorId})`)).toEqual({
      kind: 'color',
      handle: 'pournami-red',
      color: 'Navy Blue',
    })
    const sizeId = sizeRowId('pournami-red', 'Navy Blue', 'XL')
    expect(parseVariantPickerAction(`[Customer tapped "XL" (action: ${sizeId})]`)).toEqual({
      kind: 'size',
      handle: 'pournami-red',
      color: 'Navy Blue',
      size: 'XL',
    })
  })

  it('builds clipped list rows', () => {
    const colors = buildColorPickerRows('pournami-red', ['Red', 'Blue'])
    expect(colors).toHaveLength(2)
    expect(colors[0].title).toBe('Red')
    const sizes = buildSizePickerRows('pournami-red', 'Red', [
      { size: 'M', price: '499 INR' },
    ])
    expect(sizes[0].description).toBe('499 INR')
  })
})
