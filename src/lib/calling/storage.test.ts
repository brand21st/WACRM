import { describe, expect, it } from 'vitest'
import { recordingContentType, recordingObjectPath } from './storage'

describe('recordingContentType', () => {
  it('strips codec parameters so the bucket allowlist matches', () => {
    expect(recordingContentType('audio/webm;codecs=opus')).toBe('audio/webm')
    expect(recordingContentType('audio/ogg; codecs=opus')).toBe('audio/ogg')
  })

  it('keeps allowed types and falls back for empty or unknown', () => {
    expect(recordingContentType('audio/webm')).toBe('audio/webm')
    expect(recordingContentType('video/webm')).toBe('video/webm')
    expect(recordingContentType('')).toBe('audio/webm')
    expect(recordingContentType(null)).toBe('audio/webm')
    expect(recordingContentType('application/octet-stream')).toBe('audio/webm')
  })
})

describe('recordingObjectPath', () => {
  it('scopes objects to the account folder', () => {
    expect(recordingObjectPath('acc', 'call-1')).toBe('account-acc/call-1.webm')
    expect(recordingObjectPath('acc', 'call-1', 'ogg')).toBe('account-acc/call-1.ogg')
  })
})
