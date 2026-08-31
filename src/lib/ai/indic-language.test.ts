import { describe, it, expect } from 'vitest'
import {
  detectElevenLabsLanguage,
  detectIndicLanguage,
  detectRomanizedIndic,
  detectSarvamLanguage,
  detectSpokenIndicTarget,
  isIndicScript,
} from './indic-language'

describe('detectIndicLanguage', () => {
  it('maps Malayalam to ml-IN / ml', () => {
    expect(detectIndicLanguage('എത്രയെണ്ണം ഉണ്ട്?')).toEqual({
      sarvam: 'ml-IN',
      elevenlabs: 'ml',
    })
    expect(detectSarvamLanguage('നമസ്കാരം')).toBe('ml-IN')
    expect(detectElevenLabsLanguage('നമസ്കാരം')).toBe('ml')
  })

  it('maps other Indic scripts', () => {
    expect(detectIndicLanguage('नमस्ते')).toEqual({
      sarvam: 'hi-IN',
      elevenlabs: 'hi',
    })
    expect(detectIndicLanguage('வணக்கம்')).toEqual({
      sarvam: 'ta-IN',
      elevenlabs: 'ta',
    })
    expect(detectIndicLanguage('నమస్కారం')).toEqual({
      sarvam: 'te-IN',
      elevenlabs: 'te',
    })
    expect(detectIndicLanguage('ನಮಸ್ಕಾರ')).toEqual({
      sarvam: 'kn-IN',
      elevenlabs: 'kn',
    })
    expect(detectIndicLanguage('નમસ્તે')).toEqual({
      sarvam: 'gu-IN',
      elevenlabs: 'gu',
    })
    expect(detectIndicLanguage('ਸਤ ਸ੍ਰੀ ਅਕਾਲ')).toEqual({
      sarvam: 'pa-IN',
      elevenlabs: 'pa',
    })
    expect(detectIndicLanguage('নমস্কার')).toEqual({
      sarvam: 'bn-IN',
      elevenlabs: 'bn',
    })
    expect(detectIndicLanguage('ନମସ୍କାର')).toEqual({
      sarvam: 'od-IN',
      elevenlabs: 'or',
    })
  })

  it('returns null for Latin-only English (script detector)', () => {
    expect(detectIndicLanguage('how many left?')).toBeNull()
    expect(detectIndicLanguage('ethraennam und?')).toBeNull()
    expect(isIndicScript('Hello')).toBe(false)
    expect(isIndicScript('നമസ്കാരം')).toBe(true)
  })

  it('maps romanized Manglish / Hinglish / Tanglish for rewrite targeting', () => {
    expect(detectSpokenIndicTarget('ethra und alle')).toEqual({
      sarvam: 'ml-IN',
      elevenlabs: 'ml',
    })
    expect(detectRomanizedIndic('kitna hai chahiye')).toEqual({
      sarvam: 'hi-IN',
      elevenlabs: 'hi',
    })
    expect(detectSpokenIndicTarget('enna iruku venum')).toEqual({
      sarvam: 'ta-IN',
      elevenlabs: 'ta',
    })
    expect(detectSpokenIndicTarget('unda kavali cheppu')).toEqual({
      sarvam: 'te-IN',
      elevenlabs: 'te',
    })
    expect(detectSpokenIndicTarget('how many left?')).toBeNull()
  })

  it('maps Urdu Arabic script to ElevenLabs ur without a Sarvam code', () => {
    expect(detectIndicLanguage('السلام عليكم')).toEqual({
      sarvam: '',
      elevenlabs: 'ur',
    })
    expect(detectElevenLabsLanguage('السلام عليكم')).toBe('ur')
    expect(detectSarvamLanguage('السلام عليكم')).toBeNull()
  })

  it('maps Assamese romanized cues to as; Bengali script stays bn', () => {
    expect(detectSpokenIndicTarget('asen kiyo bhal')).toEqual({
      sarvam: '',
      elevenlabs: 'as',
    })
    expect(detectSpokenIndicTarget('নমস্কার')).toEqual({
      sarvam: 'bn-IN',
      elevenlabs: 'bn',
    })
  })

  it('picks the script with more characters when mixed', () => {
    expect(detectIndicLanguage('Hi നമസ്കാരം സുഖമാണോ')).toEqual({
      sarvam: 'ml-IN',
      elevenlabs: 'ml',
    })
  })
})
