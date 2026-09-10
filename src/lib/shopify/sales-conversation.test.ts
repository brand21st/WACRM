import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import { intelSeed } from '@/lib/catalog/intelligence/facts.test'
import {
  emptyShoppingContext,
  mergeShoppingContext,
} from '@/lib/catalog/intelligence/shopping-context'
import { wantsProductOrder } from './product-focus'
import { buildFocusedFactReply } from './sales-reply'
import {
  classifySalesTurn,
  shouldPersistSalesContext,
  unlocksCatalogBrowse,
  type SalesTurnKind,
} from './sales-turn'
import type { ShopifyProductHit } from './types'

const FOCUSED_HIT: ShopifyProductHit = {
  id: 'gid://shopify/Product/red',
  handle: 'red-bag',
  title: 'Red Bag',
  description: 'TYPE : Canvas bag',
  imageUrl: 'https://cdn.example/red.jpg',
  productUrl: 'https://shop.example/products/red-bag',
  cartUrl: 'https://shop.example/cart/1:1',
  checkoutUrl: 'https://shop.example/cart/1:1?checkout',
  priceMin: '1499',
  priceMax: '1499',
  currency: 'INR',
  attributes: [{ key: 'fabric', label: 'Fabric', value: 'Cotton Canvas' }],
  variants: [
    {
      id: 'v1',
      variantId: '1',
      title: 'Red / M',
      sku: 'R-M',
      price: '1499',
      compareAtPrice: null,
      available: true,
      options: [
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'M' },
      ],
    },
    {
      id: 'v2',
      variantId: '2',
      title: 'Red / L',
      sku: 'R-L',
      price: '1499',
      compareAtPrice: null,
      available: true,
      options: [
        { name: 'Color', value: 'Red' },
        { name: 'Size', value: 'L' },
      ],
    },
  ],
}

describe('15-turn focused sales conversation', () => {
  it('keeps facts, variants, switch, budget, and purchase on the right turns', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    let focus: { handle: string; title: string } | null = {
      handle: 'red-bag',
      title: 'Red Bag',
    }
    let shopping = emptyShoppingContext()
    shopping.selectedIds = ['p-red']
    shopping.shownIds = ['p-red']
    const kinds: SalesTurnKind[] = []
    const skippedLlm: boolean[] = []

    async function play(text: string) {
      const turn = classifySalesTurn(text, { hasFocus: Boolean(focus) })
      kinds.push(turn.kind)
      const fact = focus
        ? buildFocusedFactReply({
            topic: turn.topic,
            kind: turn.kind,
            ask: text,
            hit: FOCUSED_HIT,
            focus,
            language: { code: 'ml', name: 'Malayalam', script: 'native', locked: true },
          })
        : null
      skippedLlm.push(Boolean(fact))
      if (focus && unlocksCatalogBrowse(turn.kind) && turn.kind === 'product_switch') {
        shopping = {
          ...shopping,
          rejectedIds: [focus.handle === 'red-bag' ? 'p-red' : 'p-navy', ...shopping.rejectedIds],
        }
        focus = null
      } else if (unlocksCatalogBrowse(turn.kind)) {
        focus = null
      }
      if (shouldPersistSalesContext(turn.kind)) {
        shopping = await mergeShoppingContext(db, {
          accountId: 'acct-a',
          previous: shopping,
          text,
          rejectedIds:
            turn.kind === 'product_switch' ? shopping.rejectedIds : undefined,
          seedId:
            turn.kind === 'substitution' || turn.kind === 'variant_change'
              ? shopping.selectedIds[0] ?? null
              : undefined,
          nextAction: fact?.nextAction ?? turn.nextAction,
          unresolvedQuestion:
            fact?.nextAction === 'wait_for_customer'
              ? null
              : turn.kind === 'product_question'
                ? text.trim().slice(0, 240)
                : null,
        })
      }
      return { ...turn, fact }
    }

    expect((await play('this Red Bag')).kind).toBe('stay')
    expect(wantsProductOrder('this Red Bag')).toBe(false)

    const identity = await play('ഈ product എന്താണ്?')
    expect(identity.kind).toBe('product_question')
    expect(identity.topic).toBe('identity')
    expect(identity.fact?.nextAction).toBe('wait_for_customer')
    expect(focus?.handle).toBe('red-bag')
    expect(unlocksCatalogBrowse('product_question')).toBe(false)

    const material = await play('ഇത് ഏത് material ആണ്?')
    expect(material.kind).toBe('product_question')
    expect(material.topic).toBe('material')
    expect(material.fact?.text).toMatch(/Cotton Canvas/)
    expect(material.fact?.text).not.toMatch(/\?/)
    expect(shopping.unresolvedQuestion).toBeNull()

    expect((await play('how much?'))).toMatchObject({
      kind: 'product_question',
      topic: 'price',
    })
    expect(wantsProductOrder('how much?')).toBe(false)
    expect((await play('ഇത് available ആണോ?'))).toMatchObject({
      kind: 'product_question',
      topic: 'availability',
    })
    expect(focus?.handle).toBe('red-bag')

    const redAsk = await play('Red color ഉണ്ടോ?')
    expect(redAsk.kind).toBe('variant_change')
    expect(redAsk.fact?.nextAction).toBe('ask_variant')
    expect((await play('size M')).kind).toBe('variant_change')
    expect(focus?.handle).toBe('red-bag')

    expect((await play('ഇത് വേണ്ട')).kind).toBe('product_switch')
    expect(focus).toBeNull()
    expect(shopping.rejectedIds).toContain('p-red')
    expect(shopping.selectedIds).not.toContain('p-red')

    expect((await play('വേറെ saree')).kind).toBe('product_switch')
    expect((await play('₹3000 ഉള്ളിൽ')).kind).toBe('budget_change')
    expect(shopping.maxPrice).toBe(3000)

    focus = { handle: 'navy-bag', title: 'Navy Bag' }
    shopping = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous: shopping,
      selectedIds: ['p-navy'],
      shownIds: ['p-navy'],
      text: 'this Navy Bag',
    })

    expect((await play('what is this?')).kind).toBe('product_question')
    expect(focus?.handle).toBe('navy-bag')
    expect(shopping.rejectedIds).toContain('p-red')
    expect(shopping.selectedIds).not.toContain('p-red')

    expect((await play('another color')).kind).toBe('variant_change')
    expect((await play('actually blue')).kind).toBe('variant_change')
    expect(shopping.colors).toEqual(['blue'])

    expect((await play('നല്ലതാണ്')).kind).toBe('stay')
    expect(wantsProductOrder('നല്ലതാണ്')).toBe(false)
    expect(shouldPersistSalesContext('stay')).toBe(false)

    expect((await play('എടുക്കാം')).kind).toBe('purchase')
    expect(wantsProductOrder('എടുക്കാം')).toBe(true)

    expect(kinds).toEqual([
      'stay',
      'product_question',
      'product_question',
      'product_question',
      'product_question',
      'variant_change',
      'variant_change',
      'product_switch',
      'product_switch',
      'budget_change',
      'product_question',
      'variant_change',
      'variant_change',
      'stay',
      'purchase',
    ])
    expect(skippedLlm).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
    ])
    expect(shopping.maxPrice).toBe(3000)
    expect(shopping.colors).toEqual(['blue'])
    expect(focus?.handle).toBe('navy-bag')
  })

  it('clears old product focus on new products kanik and variants the newly selected item', async () => {
    const db = createCatalogMemoryDb(intelSeed())
    let focus: { handle: string; title: string } | null = {
      handle: 'red-bag',
      title: 'Red Bag',
    }
    let shopping = emptyShoppingContext()
    shopping.selectedIds = ['p-red']
    shopping.shownIds = ['p-red']
    shopping.maxPrice = 3000

    async function play(text: string) {
      const turn = classifySalesTurn(text, { hasFocus: Boolean(focus) })
      if (focus && unlocksCatalogBrowse(turn.kind) && turn.kind === 'product_switch') {
        shopping = {
          ...shopping,
          rejectedIds: [focus.handle === 'red-bag' ? 'p-red' : 'p-navy', ...shopping.rejectedIds],
        }
        focus = null
      } else if (unlocksCatalogBrowse(turn.kind)) {
        focus = null
      }
      if (shouldPersistSalesContext(turn.kind)) {
        shopping = await mergeShoppingContext(db, {
          accountId: 'acct-a',
          previous: shopping,
          text,
          rejectedIds:
            turn.kind === 'product_switch' ? shopping.rejectedIds : undefined,
          seedId:
            turn.kind === 'substitution' || turn.kind === 'variant_change'
              ? shopping.selectedIds[0] ?? null
              : undefined,
          nextAction: turn.nextAction,
        })
      }
      return turn
    }

    expect((await play('new products kanik')).kind).toBe('product_switch')
    expect(focus).toBeNull()
    expect(shopping.rejectedIds).toContain('p-red')
    expect(shopping.maxPrice).toBe(3000)
    expect(shopping.selectedIds).not.toContain('p-red')

    expect((await play('പുതിയ saree കാണിക്കൂ')).kind).toBe('product_switch')
    expect(shopping.categoryHint).toBe('saree')
    expect(shopping.maxPrice).toBe(3000)

    focus = { handle: 'navy-bag', title: 'Navy Bag' }
    shopping = await mergeShoppingContext(db, {
      accountId: 'acct-a',
      previous: shopping,
      selectedIds: ['p-navy'],
      shownIds: ['p-navy'],
      text: 'this Navy Bag',
    })

    expect((await play('size M')).kind).toBe('variant_change')
    expect(focus?.handle).toBe('navy-bag')
    expect(shopping.rejectedIds).toContain('p-red')
    expect(wantsProductOrder('new products kanik')).toBe(false)
  })
})
