import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { validateSarvamKey } from './validate'
import { SARVAM_TTS_URL } from './limits'

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

describe('validateSarvamKey', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves after a short en-IN TTS ping', async () => {
    const payload = Buffer.from([1, 2]).toString('base64')
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ audios: [payload] }),
    )
    await expect(validateSarvamKey('sv-test', { fetchImpl })).resolves.toBeUndefined()
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe(SARVAM_TTS_URL)
    expect(init.headers['api-subscription-key']).toBe('sv-test')
    const body = JSON.parse(init.body as string)
    expect(body.text).toBe('Hello')
    expect(body.language_code).toBe('en-IN')
  })

  it('maps 403 invalid_api_key_error to invalid_key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      errResponse(403, {
        error: { code: 'invalid_api_key_error', message: 'Invalid API key' },
      }),
    )
    await expect(validateSarvamKey('bad', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })
})
