import { describe, expect, it } from 'vitest'
import { DETECT_FIRST_SPOKEN_LANGUAGE } from '@/lib/ai/language-lock'
import { LIVE_AI_HANDOFF_SPOKEN } from './live-ai-turn'
import {
  LIVE_AI_HANDOFF_SPOKEN_ML,
  isMalayalamLanguageHint,
  liveAiHandoffSpoken,
  liveAiSpokenLanguageBlock,
  liveAiTranscriptionLanguage,
} from './live-ai-speech-language'

const malayalamNative = {
  code: 'ml' as const,
  name: 'Malayalam',
  script: 'native' as const,
  locked: true,
}

const malayalamManglish = {
  code: 'ml' as const,
  name: 'Malayalam',
  script: 'romanized' as const,
  locked: true,
}

describe('live AI spoken Malayalam', () => {
  it('hands off in Malayalam only when the call is locked to Malayalam', () => {
    expect(liveAiHandoffSpoken(malayalamNative)).toBe(LIVE_AI_HANDOFF_SPOKEN_ML)
    expect(liveAiHandoffSpoken(malayalamManglish)).toBe(LIVE_AI_HANDOFF_SPOKEN_ML)
    expect(liveAiHandoffSpoken(null)).toBe(LIVE_AI_HANDOFF_SPOKEN)
    expect(
      liveAiHandoffSpoken({
        code: 'en',
        name: 'English',
        script: 'latin',
        locked: true,
      }),
    ).toBe(LIVE_AI_HANDOFF_SPOKEN)
  })

  it('pins STT to Malayalam from a hard lock or prior-chat hint', () => {
    expect(liveAiTranscriptionLanguage(malayalamNative, null)).toBe('ml')
    expect(liveAiTranscriptionLanguage(null, 'Malayalam')).toBe('ml')
    expect(liveAiTranscriptionLanguage(null, 'malayalam')).toBe('ml')
    expect(liveAiTranscriptionLanguage(null, 'Hindi')).toBeNull()
    expect(liveAiTranscriptionLanguage(null, null)).toBeNull()
  })

  it('treats Malayalam language names as a hint', () => {
    expect(isMalayalamLanguageHint('Malayalam')).toBe(true)
    expect(isMalayalamLanguageHint('Hindi')).toBe(false)
  })

  it('pins native Kerala Malayalam on a hard lock', () => {
    const text = liveAiSpokenLanguageBlock(malayalamNative)
    expect(text).toContain('This WhatsApp voice call is in Malayalam')
    expect(text).toContain('Kerala Malayalam')
    expect(text).toContain('ഇതുണ്ട്, നോക്കിക്കോ')
    expect(text).toContain(LIVE_AI_HANDOFF_SPOKEN_ML)
    expect(text).not.toContain(DETECT_FIRST_SPOKEN_LANGUAGE)
  })

  it('pins Manglish when the lock is romanized', () => {
    const text = liveAiSpokenLanguageBlock(malayalamManglish)
    expect(text).toContain('Manglish')
    expect(text).toContain(LIVE_AI_HANDOFF_SPOKEN_ML)
  })

  it('greets in Malayalam when prior chat was Malayalam', () => {
    const text = liveAiSpokenLanguageBlock(null, 'Malayalam')
    expect(text).toContain('Prior WhatsApp')
    expect(text).toContain('ഹലോ, എന്താ സഹായിക്കട്ടെ')
  })

  it('detects first language when nothing is known', () => {
    const text = liveAiSpokenLanguageBlock(null, null)
    expect(text).toContain(DETECT_FIRST_SPOKEN_LANGUAGE)
    expect(text).toContain('Kerala Malayalam')
    expect(text).toContain(LIVE_AI_HANDOFF_SPOKEN)
  })
})
