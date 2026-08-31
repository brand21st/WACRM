import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AiError } from '@/lib/ai/types'
import { speechToText } from './stt'
import { SARVAM_STT_MODEL, SARVAM_STT_URL } from './limits'

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

describe('sarvam speechToText', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('posts multipart audio with saaras:v3 and returns the transcript', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ transcript: '  namaste  ' }),
    )
    const text = await speechToText({
      apiKey: 'sv-test',
      audio: AUDIO,
      mimeType: 'audio/ogg; codecs=opus',
      languageCode: 'unknown',
      fetchImpl,
    })
    expect(text).toBe('namaste')
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(SARVAM_STT_URL)
    expect(init.headers['api-subscription-key']).toBe('sv-test')
    const form = init.body as FormData
    expect(form.get('model')).toBe(SARVAM_STT_MODEL)
    expect(form.get('language_code')).toBe('unknown')
  })

  it('maps 403 invalid_api_key_error to invalid_key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      errResponse(403, {
        error: { code: 'invalid_api_key_error', message: 'Invalid API key' },
      }),
    )
    await expect(
      speechToText({
        apiKey: 'bad',
        audio: AUDIO,
        mimeType: 'audio/ogg',
        fetchImpl,
      }),
    ).rejects.toMatchObject({ code: 'invalid_key', status: 401 } satisfies Partial<AiError>)
  })
})
