import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { describeInboundImage, PRODUCT_PHOTO_PLACEHOLDER } from './describe-inbound-image'

describe('describeInboundImage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns the caption when vision is unavailable', async () => {
    const out = await describeInboundImage({
      provider: 'anthropic',
      apiKey: 'sk-test',
      mediaUrl: 'https://cdn.example/photo.jpg',
      caption: 'What is this product?',
    })
    expect(out).toBe('What is this product?')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses OpenAI vision for public image URLs', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'A red handbag on a table.' } }],
      }),
    } as Response)

    const out = await describeInboundImage({
      provider: 'openai',
      apiKey: 'sk-test',
      mediaUrl: 'https://cdn.example/photo.jpg',
      caption: null,
    })
    expect(out).toBe('A red handbag on a table.')
    expect(fetch).toHaveBeenCalled()
  })

  it('uses a shopping prompt when purpose is shopping', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Red leather tote, no logo.' } }],
      }),
    } as Response)

    await describeInboundImage({
      provider: 'openai',
      apiKey: 'sk-test',
      mediaUrl: 'https://cdn.example/photo.jpg',
      caption: null,
      purpose: 'shopping',
    })
    const opts = vi.mocked(fetch).mock.calls[0]?.[1] as { body?: string } | undefined
    const body = JSON.parse(opts?.body ?? '{}') as {
      messages: { content: { text: string }[] }[]
    }
    expect(body.messages?.[0]?.content?.[0]?.text).toMatch(/searchable attributes/i)
  })

  it('downloads Meta media as a data URL when the stored URL is not public', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Blue cotton shirt, striped.' } }],
      }),
    } as Response)

    const getMediaUrlImpl = vi.fn(async () => ({
      url: 'https://lookaside.fbsbx.com/x',
      mimeType: 'image/jpeg',
      fileSize: 12,
    }))
    const downloadMediaImpl = vi.fn(async () => ({
      buffer: Buffer.from('fake-jpeg'),
      contentType: 'image/jpeg',
    }))

    const out = await describeInboundImage({
      provider: 'openai',
      apiKey: 'sk-test',
      mediaUrl: '/api/whatsapp/media/abc',
      caption: null,
      purpose: 'shopping',
      mediaId: 'abc',
      accessToken: 'wa-token',
      getMediaUrlImpl,
      downloadMediaImpl,
    })

    expect(out).toBe('Blue cotton shirt, striped.')
    expect(getMediaUrlImpl).toHaveBeenCalledWith({
      mediaId: 'abc',
      accessToken: 'wa-token',
    })
    const opts = vi.mocked(fetch).mock.calls[0]?.[1] as { body?: string } | undefined
    const body = JSON.parse(opts?.body ?? '{}') as {
      messages: { content: { type: string; image_url?: { url: string } }[] }[]
    }
    expect(body.messages?.[0]?.content?.[1]?.image_url?.url).toMatch(
      /^data:image\/jpeg;base64,/,
    )
  })

  it('falls back to caption when Meta download fails', async () => {
    const out = await describeInboundImage({
      provider: 'openai',
      apiKey: 'sk-test',
      mediaUrl: '/api/whatsapp/media/abc',
      caption: 'Is this in stock?',
      purpose: 'shopping',
      mediaId: 'abc',
      accessToken: 'wa-token',
      getMediaUrlImpl: vi.fn(async () => {
        throw new Error('meta down')
      }),
    })
    expect(out).toBe('Is this in stock?')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses a shopping placeholder when there is no caption or public URL', async () => {
    const out = await describeInboundImage({
      provider: 'openai',
      apiKey: 'sk-test',
      mediaUrl: '/api/whatsapp/media/abc',
      caption: null,
      purpose: 'shopping',
    })
    expect(out).toBe(PRODUCT_PHOTO_PLACEHOLDER)
  })
})
