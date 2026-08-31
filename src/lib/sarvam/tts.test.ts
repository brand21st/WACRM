import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { textToSpeech } from './tts'
import {
  SARVAM_TTS_MODEL,
  SARVAM_TTS_URL,
  SARVAM_WHATSAPP_SAMPLE_RATE,
} from './limits'

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  return {
    ok: false,
    status,
    json: async () => json,
  } as unknown as Response
}

describe('sarvam textToSpeech', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts JSON and decodes the first base64 audio', async () => {
    const payload = Buffer.from([9, 8, 7]).toString('base64')
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ audios: [payload] }),
    )
    const out = await textToSpeech({
      apiKey: 'sv-test',
      text: 'Hello there',
      speaker: 'priya',
      languageCode: 'hi-IN',
      fetchImpl,
    })
    expect(Array.from(out.bytes)).toEqual([9, 8, 7])
    expect(out.mimeType).toBe('audio/mpeg')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(SARVAM_TTS_URL)
    expect(init.headers['api-subscription-key']).toBe('sv-test')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe(SARVAM_TTS_MODEL)
    expect(body.speaker).toBe('priya')
    expect(body.language_code).toBe('hi-IN')
  })

  it('uses opus mime for WhatsApp codec', async () => {
    const payload = Buffer.from([1]).toString('base64')
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ audios: [payload] }),
    )
    const out = await textToSpeech({
      apiKey: 'sv',
      text: 'Hi',
      outputAudioCodec: 'opus',
      fetchImpl,
    })
    expect(out.mimeType).toBe('audio/ogg')
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(body.output_audio_codec).toBe('opus')
    expect(body.speech_sample_rate).toBe(SARVAM_WHATSAPP_SAMPLE_RATE)
  })

  it('does not pin sample rate for mp3 preview', async () => {
    const payload = Buffer.from([1]).toString('base64')
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ audios: [payload] }),
    )
    await textToSpeech({
      apiKey: 'sv',
      text: 'Hi',
      outputAudioCodec: 'mp3',
      fetchImpl,
    })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body as string)
    expect(body.speech_sample_rate).toBeUndefined()
  })

  it('rejects empty text', async () => {
    await expect(
      textToSpeech({ apiKey: 'sv', text: '   ' }),
    ).rejects.toMatchObject({ code: 'empty_text' })
  })

  it('maps 403 invalid key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      errResponse(403, {
        error: { code: 'invalid_api_key_error', message: 'Invalid API key' },
      }),
    )
    await expect(
      textToSpeech({ apiKey: 'bad', text: 'Hi', fetchImpl }),
    ).rejects.toMatchObject({ code: 'invalid_key' })
  })
})
