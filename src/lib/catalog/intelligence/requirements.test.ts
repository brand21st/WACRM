import { describe, expect, it } from 'vitest'
import {
  parseCategoryHint,
  parseDislikes,
  parseOccasion,
  parseRecipient,
  parseRejectsShown,
  parseSelectsShown,
  parseShoppingRequirements,
  parseShownOrdinal,
  requirementsFromToolArgs,
} from './requirements'

describe('parseShoppingRequirements', () => {
  it('reads a budget, size, and cheaper phrasing from this turn', () => {
    expect(parseShoppingRequirements('too expensive, size M under 1500')).toMatchObject({
      maxPrice: 1500,
      cheaper: true,
      optionName: 'size',
      optionValue: 'M',
    })
  })

  it('reads a color token', () => {
    expect(parseShoppingRequirements('same bag in navy')).toMatchObject({
      optionValue: 'navy',
    })
  })

  it('reads 5k, Malayalam, and Manglish budgets', () => {
    expect(parseShoppingRequirements('wedding dress under 5k')).toMatchObject({
      maxPrice: 5000,
    })
    expect(parseShoppingRequirements('5000 രൂപയ്ക്കുള്ളിൽ')).toMatchObject({
      maxPrice: 5000,
    })
    expect(parseShoppingRequirements('2000 thazhe')).toMatchObject({
      maxPrice: 2000,
    })
    expect(parseShoppingRequirements('₹3000 ഉള്ളിൽ')).toMatchObject({
      maxPrice: 3000,
    })
  })
})

describe('shopping phrase helpers', () => {
  it('reads occasion, recipient, dislikes, and ordinals', () => {
    expect(parseOccasion('wedding saree')).toBe('wedding')
    expect(parseRecipient('gift for my wife')).toBe('wife')
    expect(parseDislikes("don't like red and no gold")).toEqual(['red', 'gold'])
    expect(parseShownOrdinal('the second one')).toBe(1)
    expect(parseSelectsShown('I will take this')).toBe(true)
    expect(parseRejectsShown('ഇത് വേണ്ട')).toBe(true)
    expect(parseSelectsShown('ഇത് വേണം')).toBe(true)
    expect(parseCategoryHint('another saree')).toBe('saree')
    expect(parseCategoryHint('blue kurti')).toBe('kurti')
  })
})

describe('requirementsFromToolArgs', () => {
  it('prefers explicit tool filters over parsed text', () => {
    expect(
      requirementsFromToolArgs(
        {
          min_price: 20,
          max_price: 40,
          option_name: 'Color',
          option_value: 'Navy',
          attribute_key: 'material',
          attribute_value: 'leather',
        },
        'under 1500',
      ),
    ).toEqual({
      minPrice: 20,
      maxPrice: 40,
      cheaper: false,
      optionName: 'Color',
      optionValue: 'Navy',
      attributeKey: 'material',
      attributeValue: 'leather',
    })
  })
})
