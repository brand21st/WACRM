import { describe, expect, it } from 'vitest'
import { createCatalogMemoryDb } from '@/lib/catalog/search/memory-db'
import { intelSeed } from '@/lib/catalog/intelligence/facts.test'
import {
  emptyShoppingContext,
  mergeShoppingContext,
} from '@/lib/catalog/intelligence/shopping-context'
import { wantsProductOrder } from './product-focus'
import {
  classifySalesTurn,
  shouldPersistSalesContext,
  unlocksCatalogBrowse,
  type SalesTurnKind,
} from './sales-turn'

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

    async function play(text: string) {
      const turn = classifySalesTurn(text, { hasFocus: Boolean(focus) })
      kinds.push(turn.kind)
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
          unresolvedQuestion:
            turn.kind === 'product_question' ? text.trim().slice(0, 240) : null,
        })
      }
      return turn
    }

    expect((await play('this Red Bag')).kind).toBe('stay')
    expect(wantsProductOrder('this Red Bag')).toBe(false)

    expect((await play('ഈ product എന്താണ്?')).kind).toBe('product_question')
    expect(focus?.handle).toBe('red-bag')
    expect(unlocksCatalogBrowse('product_question')).toBe(false)

    expect((await play('ഇത് ഏത് material ആണ്?')).kind).toBe('product_question')
    expect((await play('how much?')).kind).toBe('product_question')
    expect(wantsProductOrder('how much?')).toBe(false)
    expect((await play('ഇത് available ആണോ?')).kind).toBe('product_question')
    expect(focus?.handle).toBe('red-bag')

    expect((await play('Red color ഉണ്ടോ?')).kind).toBe('variant_change')
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
    expect(shopping.maxPrice).toBe(3000)
    expect(shopping.colors).toEqual(['blue'])
    expect(focus?.handle).toBe('navy-bag')
  })
})
