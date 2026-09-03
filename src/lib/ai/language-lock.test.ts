import { describe, it, expect } from 'vitest'
import {
  applyLanguageLockToFacts,
  detectChatLanguage,
  detectLanguageSwitch,
  formatReplyLanguageInstruction,
  indicCodesForLock,
  resolveLanguageLock,
  sarvamCodeFromIso,
  sttHintFromHardLock,
} from './language-lock'

describe('detectChatLanguage', () => {
  it('locks native Malayalam and romanized Manglish', () => {
    expect(detectChatLanguage('എനിക്ക് ഒരു ബാഗ് വേണം')).toMatchObject({
      code: 'ml',
      script: 'native',
      locked: true,
    })
    expect(detectChatLanguage('ethra und alle')).toMatchObject({
      code: 'ml',
      script: 'romanized',
    })
  })

  it('locks a clear English sentence', () => {
    expect(detectChatLanguage('Do you have this dress in red?')).toMatchObject({
      code: 'en',
      script: 'latin',
    })
    expect(detectChatLanguage('how many left?')).toMatchObject({
      code: 'en',
    })
  })

  it('does not lock short acks, sizes, SKUs, or empty photo text', () => {
    expect(detectChatLanguage('ok')).toBeNull()
    expect(detectChatLanguage('hi')).toBeNull()
    expect(detectChatLanguage('XL')).toBeNull()
    expect(detectChatLanguage('Need XL size')).toBeNull()
    expect(detectChatLanguage('AG26Tulip')).toBeNull()
    expect(detectChatLanguage('Pournami Red saree')).toBeNull()
    expect(detectChatLanguage('')).toBeNull()
    expect(detectChatLanguage(null)).toBeNull()
  })
})

describe('detectLanguageSwitch', () => {
  it('detects English and Indic switch phrases', () => {
    expect(detectLanguageSwitch('Please reply in English')).toMatchObject({
      code: 'en',
    })
    expect(detectLanguageSwitch('switch to Hindi')).toMatchObject({ code: 'hi' })
    expect(detectLanguageSwitch('change language to Malayalam')).toMatchObject({
      code: 'ml',
    })
    expect(detectLanguageSwitch('english il')).toMatchObject({ code: 'en' })
    expect(detectLanguageSwitch('malayalathil')).toMatchObject({ code: 'ml' })
    expect(detectLanguageSwitch('മലയാളത്തിൽ')).toMatchObject({ code: 'ml' })
    expect(detectLanguageSwitch('हिंदी में')).toMatchObject({ code: 'hi' })
    expect(detectLanguageSwitch('தமிழில்')).toMatchObject({ code: 'ta' })
    expect(detectLanguageSwitch('English please')).toMatchObject({ code: 'en' })
  })

  it('does not treat product English as a switch', () => {
    expect(
      detectLanguageSwitch('Do you have the English medium kurti in XL?'),
    ).toBeNull()
    expect(detectLanguageSwitch('I need a red dress and the price')).toBeNull()
    expect(detectLanguageSwitch('I speak English at home and want this bag')).toBeNull()
  })
})

describe('resolveLanguageLock', () => {
  it('sets the first confident language and keeps it', () => {
    const first = resolveLanguageLock({
      customerText: 'ethra und alle',
      stored: null,
    })
    expect(first.changed).toBe(true)
    expect(first.lock).toMatchObject({ code: 'ml', locked: true })

    const later = resolveLanguageLock({
      customerText: 'Do you have this dress in red?',
      stored: {
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'romanized',
        language_locked: true,
      },
    })
    expect(later.changed).toBe(false)
    expect(later.lock).toMatchObject({ code: 'ml', script: 'romanized' })
  })

  it('switches only on an explicit ask and heals an unlocked cron guess', () => {
    const switched = resolveLanguageLock({
      customerText: 'talk in English please',
      stored: {
        language: 'Malayalam',
        language_code: 'ml',
        language_script: 'native',
        language_locked: true,
      },
    })
    expect(switched.changed).toBe(true)
    expect(switched.lock).toMatchObject({ code: 'en', locked: true })

    const heal = resolveLanguageLock({
      customerText: 'എനിക്ക് റെഡ് വേണം',
      stored: {
        language: 'English',
        language_code: 'en',
        language_script: 'latin',
        language_locked: false,
      },
    })
    expect(heal.changed).toBe(true)
    expect(heal.lock).toMatchObject({ code: 'ml', locked: true })
  })
})

describe('lock helpers', () => {
  it('maps Indic locks to TTS codes and formats the prompt line', () => {
    expect(
      indicCodesForLock({
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      }),
    ).toEqual({ sarvam: 'ml-IN', elevenlabs: 'ml' })
    expect(
      indicCodesForLock({
        code: 'en',
        name: 'English',
        script: 'latin',
        locked: true,
      }),
    ).toBeNull()
    expect(
      formatReplyLanguageInstruction({
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      }),
    ).toMatch(/Locked reply language: Malayalam \(native script\)/)
    expect(
      applyLanguageLockToFacts(
        { language: null, language_locked: false },
        { code: 'hi', name: 'Hindi', script: 'native', locked: true },
      ),
    ).toMatchObject({
      language: 'Hindi',
      language_code: 'hi',
      language_locked: true,
    })
  })

  it('hints STT only after a hard lock', () => {
    expect(sttHintFromHardLock(null)).toBeNull()
    expect(
      sttHintFromHardLock({
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: false,
      }),
    ).toBeNull()
    expect(
      sttHintFromHardLock({
        code: 'ml',
        name: 'Malayalam',
        script: 'native',
        locked: true,
      }),
    ).toEqual({ iso: 'ml', sarvam: 'ml-IN' })
    expect(
      sttHintFromHardLock({
        code: 'en',
        name: 'English',
        script: 'latin',
        locked: true,
      }),
    ).toEqual({ iso: 'en', sarvam: 'en-IN' })
    expect(sarvamCodeFromIso('ml')).toBe('ml-IN')
    expect(sarvamCodeFromIso('en')).toBe('en-IN')
    expect(sarvamCodeFromIso(null)).toBe('unknown')
  })
})
