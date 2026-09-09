import { describe, expect, it } from 'vitest'
import {
  buildFollowUpSystemPrompt,
  followUpMentionsUngroundedFacts,
  hasMeaningfulFollowUpContext,
  isExplicitFollowUpDecline,
  parseFollowUpGeneration,
} from './follow-up-prompt'

describe('parseFollowUpGeneration', () => {
  it('parses send JSON', () => {
    expect(
      parseFollowUpGeneration(
        '{"action":"send","message":"Still looking at the blue kurti?","reason":"product_inquiry"}',
      ),
    ).toEqual({
      action: 'send',
      message: 'Still looking at the blue kurti?',
      reason: 'product_inquiry',
    })
  })

  it('treats skip and empty send as skip', () => {
    expect(parseFollowUpGeneration('{"action":"skip","message":"","reason":"no_context"}').action).toBe(
      'skip',
    )
    expect(
      parseFollowUpGeneration('{"action":"send","message":"","reason":"x"}').action,
    ).toBe('skip')
  })
})

describe('isExplicitFollowUpDecline', () => {
  it('treats a whole-message no/later/വേണ്ട as decline', () => {
    expect(isExplicitFollowUpDecline('വേണ്ട')).toBe(true)
    expect(isExplicitFollowUpDecline('later')).toBe(true)
    expect(isExplicitFollowUpDecline('no')).toBe(true)
    expect(isExplicitFollowUpDecline('ഇത് വേണ്ട')).toBe(false)
  })
})

describe('buildFollowUpSystemPrompt', () => {
  it('includes the sales snapshot and tells the model not to pitch rejects', () => {
    const prompt = buildFollowUpSystemPrompt({
      salesSnapshot: 'current_product: Pournami Blue\nrejected_products: p-red',
    })
    expect(prompt).toMatch(/current_product: Pournami Blue/)
    expect(prompt).toMatch(/Do not pitch rejected_products/)
    expect(prompt).toMatch(/Never send a generic “are you still interested”/)
  })
})

describe('hasMeaningfulFollowUpContext', () => {
  it('skips greeting-only threads', () => {
    expect(
      hasMeaningfulFollowUpContext([{ role: 'user', content: 'Hi' }]),
    ).toBe(false)
  })

  it('keeps product and budget threads', () => {
    expect(
      hasMeaningfulFollowUpContext([
        {
          role: 'user',
          content: 'I need a black saree for a wedding under ₹5000',
        },
      ]),
    ).toBe(true)
  })
})

describe('followUpMentionsUngroundedFacts', () => {
  it('flags prices that are not in the transcript', () => {
    expect(
      followUpMentionsUngroundedFacts(
        'We have a special ₹2499 offer today.',
        'user: I need something below 3000',
      ),
    ).toBe(true)
  })

  it('allows prices that already appeared', () => {
    expect(
      followUpMentionsUngroundedFacts(
        'I can show a few more options under 3000.',
        'user: I need something below 3000',
      ),
    ).toBe(false)
  })
})
