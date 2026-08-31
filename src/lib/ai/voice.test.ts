import { describe, it, expect } from 'vitest'
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  effectiveVoiceId,
  hasSpeechKey,
  needsTranscription,
  parseVoiceProvider,
  parseVoiceReplyMode,
  resolveReplyChannels,
} from './voice'
import { AI_VOICE_DEFAULTS } from './types'

describe('parseVoiceReplyMode', () => {
  it('accepts the four configured modes', () => {
    expect(parseVoiceReplyMode('same')).toBe('same')
    expect(parseVoiceReplyMode('text')).toBe('text')
    expect(parseVoiceReplyMode('audio')).toBe('audio')
    expect(parseVoiceReplyMode('both')).toBe('both')
  })

  it('falls back to same for junk', () => {
    expect(parseVoiceReplyMode('nope')).toBe('same')
    expect(parseVoiceReplyMode(null)).toBe('same')
  })
})

describe('effectiveVoiceId', () => {
  it('uses the account voice when set', () => {
    expect(effectiveVoiceId(' abc ')).toBe('abc')
  })

  it('falls back to the default voice', () => {
    expect(effectiveVoiceId(null)).toBe(DEFAULT_ELEVENLABS_VOICE_ID)
    expect(effectiveVoiceId('')).toBe(DEFAULT_ELEVENLABS_VOICE_ID)
  })
})

describe('resolveReplyChannels', () => {
  it('matches inbound for same', () => {
    expect(resolveReplyChannels('same', 'text')).toEqual(['text'])
    expect(resolveReplyChannels('same', 'audio')).toEqual(['audio'])
  })

  it('honours explicit modes for typed inbound', () => {
    expect(resolveReplyChannels('text', 'text')).toEqual(['text'])
    expect(resolveReplyChannels('audio', 'text')).toEqual(['audio'])
    expect(resolveReplyChannels('both', 'text')).toEqual(['text', 'audio'])
    expect(resolveReplyChannels('same', 'text')).toEqual(['text'])
  })

  it('honours explicit modes for a voice note', () => {
    expect(resolveReplyChannels('same', 'audio')).toEqual(['audio'])
    expect(resolveReplyChannels('text', 'audio')).toEqual(['text'])
    expect(resolveReplyChannels('audio', 'audio')).toEqual(['audio'])
    expect(resolveReplyChannels('both', 'audio')).toEqual(['text', 'audio'])
  })

  it('defaults image inbound to text unless voice mode asks for audio', () => {
    expect(resolveReplyChannels('same', 'image')).toEqual(['text'])
    expect(resolveReplyChannels('audio', 'image')).toEqual(['audio'])
    expect(resolveReplyChannels('both', 'image')).toEqual(['text', 'audio'])
  })
})

describe('needsTranscription', () => {
  it('is true only for audio without a transcript', () => {
    expect(needsTranscription('audio', null)).toBe(true)
    expect(needsTranscription('audio', '  ')).toBe(true)
    expect(needsTranscription('audio', 'hello')).toBe(false)
    expect(needsTranscription('text', null)).toBe(false)
  })
})

describe('parseVoiceProvider', () => {
  it('defaults to elevenlabs', () => {
    expect(parseVoiceProvider(null)).toBe('elevenlabs')
    expect(parseVoiceProvider('sarvam')).toBe('sarvam')
  })
})

describe('hasSpeechKey', () => {
  it('uses the selected provider key', () => {
    expect(
      hasSpeechKey({
        ...AI_VOICE_DEFAULTS,
        elevenlabsApiKey: 'xi',
      }),
    ).toBe(true)
    expect(
      hasSpeechKey({
        ...AI_VOICE_DEFAULTS,
        voiceProvider: 'sarvam',
        elevenlabsApiKey: 'xi',
      }),
    ).toBe(false)
    expect(
      hasSpeechKey({
        ...AI_VOICE_DEFAULTS,
        voiceProvider: 'sarvam',
        sarvamApiKey: 'sv',
      }),
    ).toBe(true)
  })
})
