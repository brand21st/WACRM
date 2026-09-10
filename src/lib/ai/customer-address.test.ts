import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_ADDRESSING_INSTRUCTION,
  hasInformalCustomerAddress,
} from './customer-address'

describe('hasInformalCustomerAddress', () => {
  it('flags informal Malayalam customer address', () => {
    expect(hasInformalCustomerAddress('നീ പറഞ്ഞത്...')).toBe(true)
    expect(hasInformalCustomerAddress('നിനക്ക് ഏത് size വേണം?')).toBe(true)
    expect(hasInformalCustomerAddress('നിന്റെ budget എത്രയാണ്?')).toBe(true)
    expect(hasInformalCustomerAddress('നിന്നോട് പറയാം')).toBe(true)
    expect(hasInformalCustomerAddress('നിന്നെ സഹായിക്കാം')).toBe(true)
  })

  it('allows respectful and pronoun-free Malayalam', () => {
    expect(hasInformalCustomerAddress('നിങ്ങൾ പറഞ്ഞ color')).toBe(false)
    expect(hasInformalCustomerAddress('നിങ്ങളുടെ budget അനുസരിച്ച്')).toBe(false)
    expect(hasInformalCustomerAddress('നിങ്ങൾക്ക് ഇഷ്ടപ്പെട്ടാൽ')).toBe(false)
    expect(hasInformalCustomerAddress('ഏത് size ആണ് വേണ്ടത്?')).toBe(false)
    expect(hasInformalCustomerAddress('ഇത് കൂടി നോക്കാം.')).toBe(false)
  })

  it('does not flag നീല or other product words that only start with നീ', () => {
    expect(hasInformalCustomerAddress('നീല kurta available ആണ്.')).toBe(false)
  })

  it('ignores informal forms inside quoted customer text', () => {
    expect(
      hasInformalCustomerAddress('Customer said: "നീ പറഞ്ഞത് ശരിയല്ല"'),
    ).toBe(false)
    expect(
      hasInformalCustomerAddress('«നീ പറഞ്ഞത് ശരിയല്ല» എന്നാണ് customer പറഞ്ഞത്.'),
    ).toBe(false)
  })

  it('flags informal Tamil and Hindi address, not respectful forms', () => {
    expect(hasInformalCustomerAddress('நீ பாரு')).toBe(true)
    expect(hasInformalCustomerAddress('நீங்கள் பாருங்க')).toBe(false)
    expect(hasInformalCustomerAddress('நீல saree')).toBe(false)
    expect(hasInformalCustomerAddress('तुम यह लो')).toBe(true)
    expect(hasInformalCustomerAddress('आपको यह चाहिए?')).toBe(false)
  })

  it('flags English slang address', () => {
    expect(hasInformalCustomerAddress('Hey bro, this kurti is nice')).toBe(true)
    expect(hasInformalCustomerAddress('This kurti is a good match.')).toBe(false)
  })
})

describe('CUSTOMER_ADDRESSING_INSTRUCTION', () => {
  it('bans informal Malayalam and prefers നിങ്ങൾ or a pronoun-free line', () => {
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/CUSTOMER ADDRESSING/)
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/നിങ്ങൾ/)
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/നീ \/ നിനക്ക് \/ നിന്റെ/)
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/நீங்கள்/)
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/आप/)
    expect(CUSTOMER_ADDRESSING_INSTRUCTION).toMatch(/bro/)
  })
})
