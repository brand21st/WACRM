import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { textToSpeech, ELEVENLABS_TTS_BASE, ELEVENLABS_TTS_MODEL, ELEVENLABS_TEXT_NORMALIZATION, ELEVENLABS_WHATSAPP_VOICE_FORMAT } from './tts'

function okAudio(bytes: Uint8Array): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer,
    headers: { get: () => 'audio/mpeg' },
  } as unknown as Response
}

function errResponse(status: number, json: unknown): Response {
  const res = {
    ok: false,
    status,
    json: async () => json,
    clone() {
      return errResponse(status, json)
    },
  }
  return res as unknown as Response
}

describe('textToSpeech', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts JSON to the voice convert endpoint', async () => {
    const bytes = new Uint8Array([9, 8, 7])
    const fetchImpl = vi.fn().mockResolvedValue(okAudio(bytes))
    const out = await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'Hello there',
      fetchImpl,
    })
    expect(out.mimeType).toBe('audio/mpeg')
    expect(Array.from(out.bytes)).toEqual([9, 8, 7])
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(`${ELEVENLABS_TTS_BASE}/voice-1`)
    expect(init.headers['xi-api-key']).toBe('xi-test')
    expect(JSON.parse(init.body)).toEqual({
      text: '[friendly] Hello there',
      model_id: ELEVENLABS_TTS_MODEL,
      apply_text_normalization: ELEVENLABS_TEXT_NORMALIZATION,
    })
  })

  it('prepares numbers and v3 audio tags before convert', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okAudio(new Uint8Array([1])))
    await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'Your total is ₹499. Call 9876543210.',
      fetchImpl,
    })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.text).toBe(
      '[friendly] Your total is [pause] rupees 499. Call [pause] 9 8 7 6 5 4 3 2 1 0.',
    )
    expect(body.apply_text_normalization).toBe('on')
  })

  it('requests Opus for WhatsApp voice notes', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
      headers: { get: () => 'application/octet-stream' },
    } as unknown as Response)
    const out = await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'Hello',
      outputFormat: ELEVENLABS_WHATSAPP_VOICE_FORMAT,
      fetchImpl,
    })
    expect(out.mimeType).toBe('audio/ogg')
    const [url] = fetchImpl.mock.calls[0]
    expect(url).toBe(
      `${ELEVENLABS_TTS_BASE}/voice-1?output_format=${encodeURIComponent(ELEVENLABS_WHATSAPP_VOICE_FORMAT)}`,
    )
  })

  it('rejects empty text', async () => {
    await expect(
      textToSpeech({ apiKey: 'xi', voiceId: 'v', text: '   ' }),
    ).rejects.toMatchObject({ code: 'empty_text' })
  })

  it('sends language_code for Indic replies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okAudio(new Uint8Array([1])))
    await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'നമസ്കാരം',
      languageCode: 'ml',
      fetchImpl,
    })
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.language_code).toBe('ml')
    expect(body.text).toBe('[warmly] നമസ്കാരം')
  })

  it('sends language_code for Hindi replies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okAudio(new Uint8Array([1])))
    await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'नमस्ते',
      languageCode: 'hi',
      fetchImpl,
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).language_code).toBe('hi')
  })

  it('does not drop language_code on an unrelated 400', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errResponse(400, { detail: { message: 'invalid voice' } }))
    await expect(
      textToSpeech({
        apiKey: 'xi-test',
        voiceId: 'voice-1',
        text: 'നമസ്കാരം',
        languageCode: 'ml',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'provider_error' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).language_code).toBe('ml')
  })

  it('retries without language_code when the model rejects that language', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        errResponse(400, {
          detail: {
            message: "Model 'eleven_flash_v2_5' does not support language_code 'ml'.",
          },
        }),
      )
      .mockResolvedValueOnce(okAudio(new Uint8Array([3])))
    const out = await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'നമസ്കാരം',
      languageCode: 'ml',
      modelId: 'eleven_flash_v2_5',
      fetchImpl,
    })
    expect(Array.from(out.bytes)).toEqual([3])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model_id).toBe('eleven_flash_v2_5')
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).language_code).toBeUndefined()
  })

  it('retries without language_code when v3 rejects the field', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        errResponse(400, { detail: { message: 'unknown field language_code' } }),
      )
      .mockResolvedValueOnce(okAudio(new Uint8Array([2])))
    const out = await textToSpeech({
      apiKey: 'xi-test',
      voiceId: 'voice-1',
      text: 'നമസ്കാരം',
      languageCode: 'ml',
      fetchImpl,
    })
    expect(Array.from(out.bytes)).toEqual([2])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).language_code).toBeUndefined()
  })

  it('maps 429 to rate_limited', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errResponse(429, { detail: 'slow down' }))
    await expect(
      textToSpeech({
        apiKey: 'xi',
        voiceId: 'v',
        text: 'hi',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'rate_limited' })
  })
})
