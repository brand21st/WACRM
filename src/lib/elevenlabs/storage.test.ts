import { describe, it, expect, vi } from 'vitest'
import { uploadGeneratedAudio } from './storage'

describe('uploadGeneratedAudio', () => {
  it('stores MPEG bytes under account-<id>/generated and returns the public URL', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://cdn.example/ai-reply.mp3' },
    })
    const storage = {
      from: vi.fn(() => ({ upload, getPublicUrl })),
    }

    const bytes = new Uint8Array([1, 2, 3])
    const out = await uploadGeneratedAudio({
      accountId: '11111111-2222-3333-4444-555555555555',
      bytes,
      mimeType: 'audio/mpeg',
      fileName: 'ai-reply.mp3',
      storage,
    })

    expect(out.publicUrl).toBe('https://cdn.example/ai-reply.mp3')
    expect(out.mimeType).toBe('audio/mpeg')
    expect(out.path).toMatch(
      /^account-11111111-2222-3333-4444-555555555555\/generated\/\d+-ai-reply\.mp3$/,
    )
    expect(storage.from).toHaveBeenCalledWith('chat-media')
    expect(upload).toHaveBeenCalledWith(
      out.path,
      bytes,
      expect.objectContaining({
        contentType: 'audio/mpeg',
        upsert: false,
      }),
    )
  })

  it('throws when storage rejects the upload', async () => {
    const storage = {
      from: () => ({
        upload: async () => ({ error: { message: 'mime not allowed' } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    }
    await expect(
      uploadGeneratedAudio({
        accountId: 'acct',
        bytes: new Uint8Array([1]),
        storage,
      }),
    ).rejects.toThrow(/mime not allowed/)
  })
})
