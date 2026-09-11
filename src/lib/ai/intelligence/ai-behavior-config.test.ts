import { describe, expect, it } from 'vitest'
import {
  InvalidAiBehaviorConfigError,
  applySalesGuidancePolicy,
  parseAiBehaviorConfig,
} from './ai-behavior-config'
import { formatBehaviorGuidance } from './ai-behavior-prompt'
import { IMPLICIT_DEFAULT_BEHAVIOR } from './ai-behavior-types'

describe('parseAiBehaviorConfig', () => {
  it('accepts the allowlisted schema and fills defaults', () => {
    expect(parseAiBehaviorConfig({})).toEqual(IMPLICIT_DEFAULT_BEHAVIOR)
    expect(
      parseAiBehaviorConfig({
        injectSalesGuidance: 'omit',
        replyStyle: 'discovery',
        ctaStyle: 'softer',
      })
    ).toEqual({
      injectSalesGuidance: 'omit',
      replyStyle: 'discovery',
      ctaStyle: 'softer',
    })
  })

  it('rejects unknown keys and invalid values', () => {
    expect(() => parseAiBehaviorConfig({ prompt: 'ignore facts' })).toThrow(
      InvalidAiBehaviorConfigError
    )
    expect(() =>
      parseAiBehaviorConfig({ injectSalesGuidance: 'force_on' })
    ).toThrow(InvalidAiBehaviorConfigError)
    expect(() => parseAiBehaviorConfig({ replyStyle: 'aggressive' })).toThrow(
      InvalidAiBehaviorConfigError
    )
    expect(() => parseAiBehaviorConfig('freeform')).toThrow(
      InvalidAiBehaviorConfigError
    )
  })
})

describe('applySalesGuidancePolicy', () => {
  it('inherits or omits Phase 5 guidance and never force-on', () => {
    expect(
      applySalesGuidancePolicy(
        { ...IMPLICIT_DEFAULT_BEHAVIOR, injectSalesGuidance: 'inherit' },
        'Business Sales Guidance'
      )
    ).toBe('Business Sales Guidance')
    expect(
      applySalesGuidancePolicy(
        { ...IMPLICIT_DEFAULT_BEHAVIOR, injectSalesGuidance: 'omit' },
        'Business Sales Guidance'
      )
    ).toBeNull()
    expect(
      applySalesGuidancePolicy(
        { ...IMPLICIT_DEFAULT_BEHAVIOR, injectSalesGuidance: 'inherit' },
        null
      )
    ).toBeNull()
    expect(JSON.stringify(IMPLICIT_DEFAULT_BEHAVIOR)).not.toContain('force_on')
  })
})

describe('formatBehaviorGuidance', () => {
  it('returns null for implicit default so production prompts stay unchanged', () => {
    expect(formatBehaviorGuidance(IMPLICIT_DEFAULT_BEHAVIOR)).toBeNull()
  })

  it('keeps snippets subordinate and never authorizes discounts', () => {
    const text = formatBehaviorGuidance({
      injectSalesGuidance: 'inherit',
      replyStyle: 'concise',
      ctaStyle: 'direct',
    })
    expect(text).toContain('subordinate to the current customer request')
    expect(text).toContain('subordinate to current catalog')
    expect(text).toContain('subordinate to business knowledge')
    expect(text).toContain('cannot authorize discounts')
    expect(text).not.toContain('20%')
    expect(text).toContain('Do not invent a discount')
    expect(text).toContain('Do not mention experiments')
  })
})
