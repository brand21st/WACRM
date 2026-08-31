import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcribeInboundVoiceNote } from './transcribe-inbound'

const h = vi.hoisted(() => ({
  loadAiConfig: vi.fn(),
  elevenLabsStt: vi.fn(),
  sarvamStt: vi.fn(),
  getMediaUrl: vi.fn(),
  downloadMedia: vi.fn(),
  checkRateLimit: vi.fn(),
}))

vi.mock('./config', () => ({ loadAiConfig: h.loadAiConfig }))
vi.mock('./admin-client', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/elevenlabs/stt', () => ({ speechToText: h.elevenLabsStt }))
vi.mock('@/lib/sarvam/stt', () => ({ speechToText: h.sarvamStt }))
vi.mock('@/lib/whatsapp/meta-api', () => ({
  getMediaUrl: h.getMediaUrl,
  downloadMedia: h.downloadMedia,
}))
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: h.checkRateLimit,
  RATE_LIMITS: { aiSttAccount: { limit: 40, windowMs: 60_000 } },
}))

import { AI_VOICE_DEFAULTS } from './types'

const BASE = {
  accountId: 'acct-1',
  mediaId: 'media-1',
  accessToken: 'tok',
  mimeType: 'audio/ogg',
  contentType: 'audio',
  contentText: null as string | null,
}

beforeEach(() => {
  h.loadAiConfig.mockResolvedValue({
    ...AI_VOICE_DEFAULTS,
    elevenlabsApiKey: 'xi-test',
    sttEnabled: true,
  })
  h.checkRateLimit.mockReturnValue({ success: true })
  h.getMediaUrl.mockResolvedValue({
    url: 'https://meta.example/a.ogg',
    mimeType: 'audio/ogg',
    fileSize: 12,
  })
  h.downloadMedia.mockResolvedValue({
    buffer: Buffer.from('ogg'),
    contentType: 'audio/ogg',
  })
  h.elevenLabsStt.mockResolvedValue('hello from a voice note')
  h.sarvamStt.mockResolvedValue('namaste from sarvam')
})

describe('transcribeInboundVoiceNote', () => {
  it('returns the transcript on the happy path', async () => {
    const text = await transcribeInboundVoiceNote(BASE)
    expect(text).toBe('hello from a voice note')
    expect(h.elevenLabsStt).toHaveBeenCalled()
    expect(h.sarvamStt).not.toHaveBeenCalled()
  })

  it('skips when the row already has a transcript (webhook replay)', async () => {
    const text = await transcribeInboundVoiceNote({
      ...BASE,
      contentText: 'already transcribed',
    })
    expect(text).toBeNull()
    expect(h.elevenLabsStt).not.toHaveBeenCalled()
    expect(h.getMediaUrl).not.toHaveBeenCalled()
  })

  it('skips when there is no ElevenLabs key', async () => {
    h.loadAiConfig.mockResolvedValue({
      ...AI_VOICE_DEFAULTS,
      elevenlabsApiKey: null,
    })
    expect(await transcribeInboundVoiceNote(BASE)).toBeNull()
    expect(h.elevenLabsStt).not.toHaveBeenCalled()
  })

  it('uses Sarvam STT when voice_provider is sarvam', async () => {
    h.loadAiConfig.mockResolvedValue({
      ...AI_VOICE_DEFAULTS,
      voiceProvider: 'sarvam',
      sarvamApiKey: 'sv-test',
      sttEnabled: true,
    })
    const text = await transcribeInboundVoiceNote(BASE)
    expect(text).toBe('namaste from sarvam')
    expect(h.sarvamStt).toHaveBeenCalled()
    expect(h.elevenLabsStt).not.toHaveBeenCalled()
  })

  it('never throws when STT fails', async () => {
    h.elevenLabsStt.mockRejectedValue(new Error('down'))
    await expect(transcribeInboundVoiceNote(BASE)).resolves.toBeNull()
  })
})
