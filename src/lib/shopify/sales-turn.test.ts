import { describe, expect, it } from 'vitest'
import { classifySalesTurn, unlocksCatalogBrowse } from './sales-turn'

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
    expect(classifySalesTurn('what material is this?', { hasFocus: true }).kind).toBe(
      'product_question',
    )
    expect(classifySalesTurn('how much?', { hasFocus: true }).kind).toBe(
      'product_question',
    )
    expect(classifySalesTurn('available?', { hasFocus: true }).kind).toBe(
      'product_question',
    )
  })

  it('classifies comparison asks', () => {
    expect(classifySalesTurn('this or that, which is cheaper?').kind).toBe(
      'comparison',
    )
    expect(classifySalesTurn('which is better').kind).toBe('comparison')
  })
})
