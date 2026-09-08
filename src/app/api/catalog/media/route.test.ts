import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((err: unknown) =>
    Response.json({ error: String(err) }, { status: 500 }),
  ),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { adminAction: { limit: 30, windowMs: 60_000 } },
}))

import { POST } from './route'

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.upload.mockReset()
  mocks.getPublicUrl.mockReset()
})

describe('POST /api/catalog/media', () => {
  it('rejects a non-image and keeps the path account-scoped', async () => {
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: { storage: { from: () => ({ upload: mocks.upload }) } },
    })
    const form = new FormData()
    form.set('file', new File(['x'], 'note.txt', { type: 'text/plain' }))
    const res = await POST(
      new Request('http://localhost/api/catalog/media', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(400)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('uploads a jpeg under account/catalog', async () => {
    mocks.upload.mockResolvedValue({ error: null })
    mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://cdn.test/img.jpg' } })
    mocks.requireRole.mockResolvedValue({
      accountId: 'acct-1',
      userId: 'user-1',
      supabase: {
        storage: {
          from: () => ({
            upload: mocks.upload,
            getPublicUrl: mocks.getPublicUrl,
          }),
        },
      },
    })
    const form = new FormData()
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'bag.jpg', { type: 'image/jpeg' }))
    const res = await POST(
      new Request('http://localhost/api/catalog/media', { method: 'POST', body: form }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://cdn.test/img.jpg')
    expect(body.path).toMatch(/^account-acct-1\/catalog\//)
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^account-acct-1\/catalog\//),
      expect.any(File),
      expect.objectContaining({ contentType: 'image/jpeg' }),
    )
  })
})
