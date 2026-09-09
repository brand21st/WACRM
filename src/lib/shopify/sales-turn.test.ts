import { describe, expect, it } from 'vitest'
import { classifySalesTurn, unlocksCatalogBrowse, shouldPersistSalesContext } from './sales-turn'

describe('classifySalesTurn', () => {
  it('treats greetings as stay', () => {
    expect(classifySalesTurn('hi').kind).toBe('stay')
    expect(classifySalesTurn('ok').kind).toBe('stay')
    expect(classifySalesTurn('ഹായ്').kind).toBe('stay')
  })

  it('classifies purchase lines including I’ll take this', () => {
    expect(classifySalesTurn("I'll take this").kind).toBe('purchase')
    expect(classifySalesTurn('I want to buy this').kind).toBe('purchase')
    expect(classifySalesTurn('ഇത് വേണം').kind).toBe('purchase')
    expect(classifySalesTurn('വാങ്ങണം').kind).toBe('purchase')
  })

  it('does not treat ഇത് വേണ്ട as purchase', () => {
    expect(classifySalesTurn('ഇത് വേണ്ട').kind).toBe('product_switch')
    expect(classifySalesTurn("don't want this").kind).toBe('product_switch')
    expect(classifySalesTurn('not this').kind).toBe('product_switch')
  })

  it('classifies category + another as product switch', () => {
    expect(classifySalesTurn('വേറെ saree').kind).toBe('product_switch')
    expect(classifySalesTurn('show another model').kind).toBe('product_switch')
    expect(classifySalesTurn('another saree please').kind).toBe('product_switch')
  })

  it('treats more-options taps as switch', () => {
    expect(
      classifySalesTurn(
        '[Customer tapped "Check other options" (action: wacrm:more_options)]',
      ).kind,
    ).toBe('product_switch')
    expect(classifySalesTurn('hi', { moreOptions: true }).kind).toBe('product_switch')
  })

  it('keeps another color/size as variant, not switch', () => {
    expect(classifySalesTurn('another color', { hasFocus: true }).kind).toBe(
      'variant_change',
    )
    expect(classifySalesTurn('same one in red, M', { hasFocus: true }).kind).toBe(
      'variant_change',
    )
    expect(classifySalesTurn('red M', { hasFocus: true }).kind).toBe('variant_change')
    expect(unlocksCatalogBrowse('variant_change')).toBe(false)
  })

  it('classifies cheaper / similar as substitution', () => {
    expect(classifySalesTurn('too expensive').kind).toBe('substitution')
    expect(classifySalesTurn('show similar').kind).toBe('substitution')
    expect(classifySalesTurn('something better').kind).toBe('substitution')
    expect(unlocksCatalogBrowse('substitution')).toBe(true)
    expect(unlocksCatalogBrowse('product_switch')).toBe(true)
  })

  it('classifies budget changes including Malayalam', () => {
    expect(classifySalesTurn('under 3k').kind).toBe('budget_change')
    expect(classifySalesTurn('3000 രൂപയ്ക്കുള്ളിൽ').kind).toBe('budget_change')
    expect(classifySalesTurn('₹3000 ഉള്ളിൽ').kind).toBe('budget_change')
  })

  it('lets the latest preference win', () => {
    expect(classifySalesTurn('I prefer red').kind).toBe('preference_change')
    expect(classifySalesTurn('actually blue').kind).toBe('preference_change')
  })

  it('keeps product questions on the current item', () => {
    expect(classifySalesTurn('what material is this?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'material',
    })
    expect(classifySalesTurn('how much?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'price',
    })
    expect(classifySalesTurn('available?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'availability',
    })
    expect(classifySalesTurn('what is this?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'identity',
    })
    expect(classifySalesTurn('tell me about this', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'identity',
    })
    expect(classifySalesTurn('ഈ product എന്താണ്?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'identity',
    })
    expect(classifySalesTurn('ഇതെന്താണ്?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'identity',
    })
    expect(classifySalesTurn('ഇത് ഏത് material ആണ്?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'material',
    })
    expect(classifySalesTurn('ഇത് available ആണോ?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'availability',
    })
    expect(classifySalesTurn('cotton ആണോ?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'material',
    })
    expect(classifySalesTurn('what fabric is this?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'material',
    })
    expect(classifySalesTurn('is this cotton?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'material',
    })
    expect(classifySalesTurn('how does this fit?', { hasFocus: true })).toMatchObject({
      kind: 'product_question',
      topic: 'other',
    })
    expect(unlocksCatalogBrowse('product_question')).toBe(false)
  })

  it('treats a named color availability ask as variant, not a product switch', () => {
    expect(classifySalesTurn('Red color ഉണ്ടോ?', { hasFocus: true }).kind).toBe(
      'variant_change',
    )
  })

  it('does not treat polite praise as purchase', () => {
    expect(classifySalesTurn('നല്ലതാണ്', { hasFocus: true }).kind).toBe('stay')
    expect(classifySalesTurn('nice', { hasFocus: true }).kind).toBe('stay')
    expect(classifySalesTurn('looks good', { hasFocus: true }).kind).toBe('stay')
    expect(classifySalesTurn('looks beautiful', { hasFocus: true }).kind).toBe('stay')
  })

  it('classifies Malayalam take-it as purchase', () => {
    expect(classifySalesTurn('എടുക്കാം', { hasFocus: true }).kind).toBe('purchase')
    expect(classifySalesTurn('ഇത് എടുക്കാം', { hasFocus: true }).kind).toBe('purchase')
    expect(classifySalesTurn('എടുക്കട്ടെ', { hasFocus: true }).kind).toBe('purchase')
  })

  it('classifies budget plus another product as a switch that still carries the budget text', () => {
    expect(
      classifySalesTurn('3000 രൂപയ്ക്കുള്ളിൽ വേറെ saree', { hasFocus: true }).kind,
    ).toBe('product_switch')
  })

  it('does not persist polite praise as shopping facts', () => {
    expect(shouldPersistSalesContext('stay')).toBe(false)
    expect(shouldPersistSalesContext('product_question')).toBe(true)
    expect(shouldPersistSalesContext('purchase')).toBe(true)
  })

  it('classifies comparison asks', () => {
    expect(classifySalesTurn('this or that, which is cheaper?').kind).toBe(
      'comparison',
    )
    expect(classifySalesTurn('which is better').kind).toBe('comparison')
  })
})
