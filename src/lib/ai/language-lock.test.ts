import { describe, it, expect } from 'vitest'
import {
  applyLanguageLockToFacts,
  detectChatLanguage,
  detectLanguageSwitch,
  formatReplyLanguageInstruction,
  indicCodesForLock,
  isLanguageChoiceOnly,
  lockFromPickerId,
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
  it('does not auto-lock from first-message script until a picker tap', () => {
    const first = resolveLanguageLock({
      customerText: 'ethra und alle',
      stored: null,
    })
    expect(first.changed).toBe(false)
    expect(first.lock).toBeNull()

    const namaskaram = resolveLanguageLock({
      customerText: 'നമസ്കാരം',
      stored: null,
    })
    expect(namaskaram.lock).toBeNull()

    const fromTap = resolveLanguageLock({
      customerText: '[Customer tapped "Malayalam" (action: wacrm:lang:ml)]',
      stored: null,
    })
    expect(fromTap.changed).toBe(true)
    expect(fromTap.lock).toMatchObject({ code: 'ml', locked: true })
  })

  it('keeps a hard lock through English product names', () => {
    const later = resolveLanguageLock({
      customerText: 'I want the red saree',
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

  it('switches only on an explicit ask and does not heal an unlocked guess', () => {
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

    const unlocked = resolveLanguageLock({
      customerText: 'എനിക്ക് റെഡ് വേണം',
      stored: {
        language: 'English',
        language_code: 'en',
        language_script: 'latin',
        language_locked: false,
      },
    })
    expect(unlocked.changed).toBe(false)
    expect(unlocked.lock).toBeNull()
  })

  it('can still lock from detected speech when callers opt in', () => {
    const first = resolveLanguageLock({
      customerText: 'ethra und alle',
      stored: null,
      lockFromDetectedSpeech: true,
    })
    expect(first.changed).toBe(true)
    expect(first.lock).toMatchObject({ code: 'ml', locked: true })
  })
})

describe('lockFromPickerId', () => {
  it('locks the four picker languages', () => {
    expect(lockFromPickerId('wacrm:lang:hi')).toMatchObject({
      code: 'hi',
      locked: true,
    })
    expect(lockFromPickerId('wacrm:products')).toBeNull()
    expect(isLanguageChoiceOnly('Malayalam')).toBe(true)
    expect(isLanguageChoiceOnly('talk in Hindi, I want the red saree')).toBe(
      false,
    )
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
