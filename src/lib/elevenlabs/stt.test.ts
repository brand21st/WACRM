import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiError } from '@/lib/ai/types'
import { speechToText, ELEVENLABS_STT_URL, ELEVENLABS_STT_MODEL } from './stt'
import { STT_MAX_BYTES } from './limits'

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

const AUDIO = new Uint8Array([1, 2, 3, 4])

describe('speechToText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts multipart audio with scribe_v2 and returns the transcript', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(okResponse({ text: '  hello  ' }))
    const text = await speechToText({
      apiKey: 'xi-test',
      audio: AUDIO,
      mimeType: 'audio/ogg; codecs=opus',
      fetchImpl,
    })
    expect(text).toBe('hello')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(ELEVENLABS_STT_URL)
    expect(init.headers['xi-api-key']).toBe('xi-test')
    expect(init.body).toBeInstanceOf(FormData)
    const form = init.body as FormData
    expect(form.get('model_id')).toBe(ELEVENLABS_STT_MODEL)
    expect(form.get('file')).toBeInstanceOf(Blob)
  })

  it('rejects unsupported MIME types', async () => {
    await expect(
      speechToText({
        apiKey: 'xi',
        audio: AUDIO,
        mimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'unsupported_audio', status: 400 })
  })

  it('rejects oversized audio', async () => {
    await expect(
      speechToText({
        apiKey: 'xi',
        audio: new Uint8Array(STT_MAX_BYTES + 1),
        mimeType: 'audio/webm',
      }),
    ).rejects.toMatchObject({ code: 'audio_too_large' })
  })

  it('maps 401 to invalid_key', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(errResponse(401, { detail: { message: 'bad' } }))
    await expect(
      speechToText({
        apiKey: 'xi',
        audio: AUDIO,
        mimeType: 'audio/webm',
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(AiError)
    await expect(
      speechToText({
        apiKey: 'xi',
        audio: AUDIO,
        mimeType: 'audio/webm',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 })
  })
})
