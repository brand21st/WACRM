import { describe, it, expect } from 'vitest'
import {
  LIVE_AI_PROMPT_MAX,
  liveAiCallUserPrompt,
  parseLiveAiPromptField,
} from './live-ai-prompt'

describe('parseLiveAiPromptField', () => {
  it('trims, clears empty, and rejects over-long or non-string values', () => {
    expect(parseLiveAiPromptField(null)).toEqual({ ok: true, value: null })
    expect(parseLiveAiPromptField('  ')).toEqual({ ok: true, value: null })
    expect(parseLiveAiPromptField('  Warm  ')).toEqual({ ok: true, value: 'Warm' })
    expect(parseLiveAiPromptField(1)).toEqual({ ok: false })
    expect(parseLiveAiPromptField('x'.repeat(LIVE_AI_PROMPT_MAX + 1))).toEqual({ ok: false })
    expect(parseLiveAiPromptField('x'.repeat(LIVE_AI_PROMPT_MAX))).toEqual({
      ok: true,
      value: 'x'.repeat(LIVE_AI_PROMPT_MAX),
    })
  })
})

describe('liveAiCallUserPrompt', () => {
  it('falls back to the chat prompt when all call fields are empty', () => {
    expect(
      liveAiCallUserPrompt({
        behaviour: '  ',
        businessContext: null,
        instructions: undefined,
        chatPrompt: ' We sell bags. ',
      }),
    ).toBe('We sell bags.')
  })

  it('replaces the chat prompt when any call field is set', () => {
    const text = liveAiCallUserPrompt({
      behaviour: 'Warm and brief',
      businessContext: 'We sell bags.',
      instructions: 'Never quote prices.',
      chatPrompt: 'Chat-only rules',
    })
    expect(text).toContain('Call behaviour:\nWarm and brief')
    expect(text).toContain('Business context:\nWe sell bags.')
    expect(text).toContain('Call instructions:\nNever quote prices.')
    expect(text).not.toContain('Chat-only rules')
  })
})
