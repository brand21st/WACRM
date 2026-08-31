import { describe, it, expect, vi } from 'vitest'
import { rehostPublicImage, uploadGeneratedImage } from './generated-media'

describe('uploadGeneratedImage', () => {
  it('stores bytes under account-<id>/generated and returns the public URL', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://cdn.example/catalog.jpg' },
    })
    const storage = {
      from: vi.fn(() => ({ upload, getPublicUrl })),
    }

    const out = await uploadGeneratedImage({
      accountId: '11111111-2222-3333-4444-555555555555',
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/jpeg',
      fileName: 'catalog.jpg',
      storage,
    })

    expect(out.publicUrl).toBe('https://cdn.example/catalog.jpg')
    expect(out.path).toMatch(
      /^account-11111111-2222-3333-4444-555555555555\/generated\/\d+-catalog\.jpg$/,
    )
    expect(storage.from).toHaveBeenCalledWith('chat-media')
  })
})

describe('rehostPublicImage', () => {
  it('downloads the source and uploads it to chat-media', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const getPublicUrl = vi.fn().mockReturnValue({
      data: { publicUrl: 'https://cdn.example/hosted.jpg' },
    })
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([9, 9, 9]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )

    const url = await rehostPublicImage({
      accountId: 'acct-1',
      sourceUrl: 'https://cdn.shopify.com/bag.jpg',
      fetchImpl: fetchImpl as typeof fetch,
      storage: { from: () => ({ upload, getPublicUrl }) },
    })
    expect(url).toBe('https://cdn.example/hosted.jpg')
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://cdn.shopify.com/bag.jpg',
      expect.any(Object),
    )
  })
})
