import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { addVoice, listVoices } from './voices'

function okResponse(json: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => json,
  } as unknown as Response
}

describe('elevenlabs voices', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('lists voices and maps ids', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({
        voices: [
          { voice_id: 'v1', name: 'Clone', category: 'cloned', preview_url: null },
        ],
      }),
    )
    const voices = await listVoices('xi', { fetchImpl })
    expect(voices).toEqual([
      { voiceId: 'v1', name: 'Clone', category: 'cloned', previewUrl: null },
    ])
  })

  it('adds a cloned voice and returns the id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      okResponse({ voice_id: 'new-voice' }),
    )
    const out = await addVoice({
      apiKey: 'xi',
      name: 'Brand',
      files: [
        { bytes: new Uint8Array([1, 2]), mimeType: 'audio/webm', fileName: 'a.webm' },
      ],
      fetchImpl,
    })
    expect(out.voiceId).toBe('new-voice')
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.body).toBeInstanceOf(FormData)
  })

  it('rejects addVoice with no files', async () => {
    await expect(
      addVoice({ apiKey: 'xi', name: 'Brand', files: [] }),
    ).rejects.toMatchObject({ code: 'missing_audio' })
  })
})
