import { describe, expect, it } from 'vitest'
import type { ChatLanguageLock } from '@/lib/ai/language-lock'
import { hasInformalCustomerAddress } from '@/lib/ai/customer-address'
import type { ShopifyProductHit, ShopifyVariantHit } from './types'
import { buildFocusedFactReply, focusedReplyDirective } from './sales-reply'
import { classifySalesTurn } from './sales-turn'

const ML: ChatLanguageLock = {
  code: 'ml',
  name: 'Malayalam',
  script: 'native',
  locked: true,
}

const EN: ChatLanguageLock = {
  code: 'en',
  name: 'English',
  script: 'latin',
  locked: true,
}

const HI: ChatLanguageLock = {
  code: 'hi',
  name: 'Hindi',
  script: 'native',
  locked: true,
}

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
    description: '<p>TYPE : A-Line Kurti. Soft rayon co-ord.</p>',
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

describe('buildFocusedFactReply', () => {
  it('A answers identity from type, not material, and stops', () => {
    const reply = buildFocusedFactReply({
      topic: 'identity',
      kind: 'product_question',
      ask: 'ഈ product എന്താണ്?',
      hit: STOCKED,
      language: ML,
    })
    expect(reply?.text).toBe('ഇത് ഒരു A-Line Kurti ആണ്.')
    expect(reply?.nextAction).toBe('wait_for_customer')
    expect(reply?.text).not.toMatch(/Rayon|material|\?/)
  })

  it('B answers material from the structured fabric field only', () => {
    const hit = product(STOCKED.variants, {
      attributes: [{ key: 'fabric', label: 'Fabric', value: 'Rayon' }],
    })
    const reply = buildFocusedFactReply({
      topic: 'material',
      kind: 'product_question',
      ask: 'ഇത് ഏത് material ആണ്?',
      hit,
      language: ML,
    })
    expect(reply?.text).toBe('ഇത് Rayon material ആണ്.')
    expect(reply?.nextAction).toBe('wait_for_customer')
    expect(reply?.text).not.toMatch(/\?|A-Line|Kurti/)
  })

  it('C answers availability without asking a picker question', () => {
    const reply = buildFocusedFactReply({
      topic: 'availability',
      kind: 'product_question',
      ask: 'ഇത് available ആണോ?',
      hit: STOCKED,
      language: ML,
    })
    expect(reply?.text).toMatch(/സ്റ്റോക്കിലുണ്ട്/)
    expect(reply?.nextAction).toBe('wait_for_customer')
    expect(reply?.text).not.toMatch(/ഏത് size/)
  })

  it('D confirms a named color and asks size only when several remain', () => {
    const reply = buildFocusedFactReply({
      kind: 'variant_change',
      ask: 'Red color ഉണ്ടോ?',
      hit: STOCKED,
      language: ML,
    })
    expect(reply?.text).toBe('Red available ആണ്. ഏത് size വേണം?')
    expect(reply?.nextAction).toBe('ask_variant')
  })

  it('E does not invent material from a Linen title', () => {
    const hit = product(STOCKED.variants, {
      title: 'Royal Crest Premium Linen',
      handle: 'royal-crest-premium-linen',
      description: 'Looks like linen. TYPE : Aline kurti.',
      attributes: [
        { key: 'material', label: 'Material', value: 'Premium Cotton Duck' },
      ],
    })
    const reply = buildFocusedFactReply({
      topic: 'material',
      kind: 'product_question',
      ask: 'what material is this?',
      hit,
      language: EN,
    })
    expect(reply?.text).toBe('The material is Premium Cotton Duck.')
    expect(reply?.text).not.toMatch(/Linen/)
  })

  it('F says material is unavailable when only the title mentions Silk', () => {
    const hit = product(STOCKED.variants, {
      title: 'Vatican Silk Coord set AG2668',
      description: 'MATERIAL : Vatican silk with foil print TYPE : Aline',
      attributes: [
        { key: 'color', label: 'Color', value: 'Black' },
        { key: 'size', label: 'Size', value: 'L' },
      ],
    })
    const reply = buildFocusedFactReply({
      topic: 'material',
      kind: 'product_question',
      ask: 'ഇത് ഏത് material ആണ്?',
      hit,
      language: ML,
    })
    expect(reply?.text).toBe(
      'ഈ product-ന്റെ material information ഇപ്പോൾ ലഭ്യമല്ല.',
    )
    expect(reply?.text).not.toMatch(/Silk|Vatican/)
  })

  it('G confirms the only remaining size and does not ask', () => {
    const reply = buildFocusedFactReply({
      kind: 'variant_change',
      ask: 'Blue ഉണ്ടോ?',
      hit: STOCKED,
      language: ML,
    })
    expect(reply?.text).toBe('Blue-ൽ M മാത്രമാണ് available.')
    expect(reply?.nextAction).toBe('wait_for_customer')
    expect(reply?.text).not.toMatch(/ഏത് size/)
  })

  it('H never asks size or color on a no-option product', () => {
    const plain = product([variant('9', null, null)])
    const reply = buildFocusedFactReply({
      kind: 'variant_change',
      ask: 'size M',
      hit: plain,
      language: EN,
    })
    expect(reply?.text).toBe('Yes, it is in stock.')
    expect(reply?.nextAction).toBe('wait_for_customer')
    expect(reply?.text).not.toMatch(/size|color|which/i)
  })

  it('I answers price from catalog min/max', () => {
    const reply = buildFocusedFactReply({
      topic: 'price',
      kind: 'product_question',
      ask: 'how much?',
      hit: STOCKED,
      language: EN,
    })
    expect(reply?.text).toBe('The price is 1499 rupees.')
    expect(reply?.nextAction).toBe('wait_for_customer')
  })

  it('J uses short English when another language is locked', () => {
    const hit = product(STOCKED.variants, {
      attributes: [{ key: 'fabric', label: 'Fabric', value: 'Rayon' }],
    })
    const reply = buildFocusedFactReply({
      topic: 'material',
      kind: 'product_question',
      ask: 'यह कौन सा material है?',
      hit,
      language: HI,
    })
    expect(reply?.text).toBe('The material is Rayon.')
  })

  it('K names real alternatives when a combo is out of stock', () => {
    const reply = buildFocusedFactReply({
      kind: 'variant_change',
      ask: 'Blue L',
      hit: STOCKED,
      language: EN,
    })
    expect(reply?.text).toMatch(/Blue \/ L is out of stock/)
    expect(reply?.text).toMatch(/Only size M remains/)
    expect(reply?.nextAction).toBe('wait_for_customer')
  })

  it('L returns null for switch, purchase, and other questions so the LLM can run', () => {
    expect(
      buildFocusedFactReply({
        kind: 'product_switch',
        ask: 'വേറെ saree',
        hit: STOCKED,
        language: ML,
      }),
    ).toBeNull()
    expect(
      buildFocusedFactReply({
        kind: 'purchase',
        ask: 'എടുക്കാം',
        hit: STOCKED,
        language: ML,
      }),
    ).toBeNull()
    expect(
      buildFocusedFactReply({
        topic: 'other',
        kind: 'product_question',
        ask: 'how does this fit?',
        hit: STOCKED,
        language: EN,
      }),
    ).toBeNull()
  })

  it('M marks availability unknown only when stock is not trustworthy', () => {
    const unknown = product([], { checkoutUrl: null, cartUrl: null })
    const reply = buildFocusedFactReply({
      topic: 'availability',
      kind: 'product_question',
      ask: 'available?',
      hit: unknown,
      language: EN,
    })
    expect(reply?.text).toMatch(/not available right now/)
  })

  it('N answers cotton asks from the structured material only', () => {
    const hit = product(STOCKED.variants, {
      attributes: [{ key: 'fabric', label: 'Fabric', value: 'Rayon' }],
    })
    const reply = buildFocusedFactReply({
      topic: 'material',
      kind: 'product_question',
      ask: 'cotton ആണോ?',
      hit,
      language: ML,
    })
    expect(reply?.text).toBe('അല്ല, ഇത് Rayon material ആണ്.')
    expect(reply?.text).not.toMatch(/\?/)
  })
})

describe('focusedReplyDirective', () => {
  it('tells the model to answer this topic only', () => {
    const turn = classifySalesTurn('ഇത് ഏത് material ആണ്?', { hasFocus: true })
    expect(focusedReplyDirective(turn)).toMatch(/material question only/)
    expect(focusedReplyDirective(turn)).toMatch(/Do not recap the product card/)
    expect(focusedReplyDirective({ kind: 'stay' })).toBeNull()
  })
})

describe('Malayalam fact replies stay respectful', () => {
  it('does not use informal second-person address', () => {
    const samples = [
      buildFocusedFactReply({
        topic: 'identity',
        kind: 'product_question',
        ask: 'ഇത് എന്താണ്?',
        hit: STOCKED,
        language: ML,
      })?.text,
      buildFocusedFactReply({
        topic: 'material',
        kind: 'product_question',
        ask: 'ഇത് ഏത് material ആണ്?',
        hit: product(STOCKED.variants, {
          attributes: [{ key: 'fabric', label: 'Fabric', value: 'Rayon' }],
        }),
        language: ML,
      })?.text,
      buildFocusedFactReply({
        topic: 'availability',
        kind: 'product_question',
        ask: 'available?',
        hit: STOCKED,
        language: ML,
      })?.text,
      buildFocusedFactReply({
        topic: 'price',
        kind: 'product_question',
        ask: 'എത്ര?',
        hit: STOCKED,
        language: ML,
      })?.text,
    ]
    for (const text of samples) {
      expect(text).toBeTruthy()
      expect(hasInformalCustomerAddress(text)).toBe(false)
      expect(text).not.toMatch(/നിനക്ക്|നിന്റെ/)
      expect(text).not.toMatch(/നീ(?![\u0D00-\u0D7F])/)
    }
  })
})
