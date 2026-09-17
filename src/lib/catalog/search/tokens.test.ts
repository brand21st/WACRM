import { describe, expect, it } from 'vitest'
import {
  catalogFtsAndQuery,
  catalogFtsOrQuery,
  catalogFtsRequiredQuery,
  catalogSearchNeedles,
  compactText,
  concatenatedSearchNeedles,
  productAskTokens,
} from './tokens'

describe('product ask tokens', () => {
  it('strips chat filler for every merchant language mix', () => {
    expect(productAskTokens('I would like to know about the toy camera')).toEqual([
      'toy',
      'camera',
    ])
    expect(productAskTokens('send me the red bag')).toEqual(['red', 'bag'])
    expect(productAskTokens('cord set വേണം')).toEqual(['cord', 'set', 'വേണം'])
  })

  it('keeps hyphenated names as compact and parts', () => {
    expect(productAskTokens('t-shirt')).toEqual(['tshirt', 'shirt'])
    expect(productAskTokens('wash-up kitchen')).toEqual(['washup', 'wash', 'up', 'kitchen'])
  })
})

describe('FTS relax helpers', () => {
  it('ANDs first, then drops modifiers, then ORs', () => {
    expect(catalogFtsAndQuery('toy camera')).toBe('toy camera')
    expect(catalogFtsRequiredQuery('toy camera')).toBe('camera')
    expect(catalogFtsOrQuery('toy camera')).toBe('toy OR camera')
    expect(catalogFtsRequiredQuery('red bag')).toBe('red bag')
  })
})

describe('catalogSearchNeedles', () => {
  it('prefers the distinctive token over category fluff', () => {
    expect(catalogSearchNeedles('toy camera')).toEqual(['camera'])
    expect(catalogSearchNeedles('Washup toy')).toEqual(['washup'])
    expect(concatenatedSearchNeedles('washup')).toEqual(expect.arrayContaining(['wash']))
    expect(compactText('Itoys Wash Up Kitchen Set')).toContain('washup')
  })
})
