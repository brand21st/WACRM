import { describe, it, expect } from 'vitest'
import {
  parseLiveAiAnswer,
  liveAiTimeoutMs,
  parseRecordingAnnouncementLanguage,
  sanitizeRecordingPurpose,
  metaRecordingPayload,
  spokenRecordingNotice,
  DEFAULT_RECORDING_PURPOSE,
} from './settings'

describe('live AI settings helpers', () => {
  it('parses known values and falls back to off', () => {
    expect(parseLiveAiAnswer('ai_first')).toBe('ai_first')
    expect(parseLiveAiAnswer('after_timeout')).toBe('after_timeout')
    expect(parseLiveAiAnswer('off')).toBe('off')
    expect(parseLiveAiAnswer('nope')).toBe('off')
    expect(parseLiveAiAnswer(undefined)).toBe('off')
  })

  it('caps auto-answer wait under Meta’s accept window', () => {
    expect(liveAiTimeoutMs(45)).toBe(25_000)
    expect(liveAiTimeoutMs(10)).toBe(15_000)
    expect(liveAiTimeoutMs(20)).toBe(20_000)
  })
})

describe('Meta recording settings', () => {
  it('accepts supported announcement locales and falls back to en_US', () => {
    expect(parseRecordingAnnouncementLanguage('es_ES')).toBe('es_ES')
    expect(parseRecordingAnnouncementLanguage('ko')).toBe('en_US')
    expect(parseRecordingAnnouncementLanguage(undefined)).toBe('en_US')
  })

  it('enforces purpose length', () => {
    expect(sanitizeRecordingPurpose('  quality and training purposes  ')).toBe(
      DEFAULT_RECORDING_PURPOSE,
    )
    expect(sanitizeRecordingPurpose('')).toBeNull()
    expect(sanitizeRecordingPurpose('x'.repeat(251))).toBeNull()
  })

  it('builds Graph recording only when enabled with a valid purpose', () => {
    expect(
      metaRecordingPayload({
        recording_enabled: false,
        recording_purpose: DEFAULT_RECORDING_PURPOSE,
        recording_announcement_language: 'en_US',
      }),
    ).toBeNull()
    expect(
      metaRecordingPayload({
        recording_enabled: true,
        recording_purpose: '',
        recording_announcement_language: 'en_US',
      }),
    ).toBeNull()
    expect(
      metaRecordingPayload({
        recording_enabled: true,
        recording_purpose: DEFAULT_RECORDING_PURPOSE,
        recording_announcement_language: 'en_US',
      }),
    ).toEqual({
      status: 'ENABLED',
      purpose: DEFAULT_RECORDING_PURPOSE,
      announcement_language: 'en_US',
    })
  })

  it('previews Meta’s English spoken notice', () => {
    expect(spokenRecordingNotice(DEFAULT_RECORDING_PURPOSE)).toBe(
      'The audio of this call will be recorded for the following purpose: quality and training purposes',
    )
  })
})
