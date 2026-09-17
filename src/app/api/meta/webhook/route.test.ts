import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  verify: vi.fn(),
  secrets: ['app-secret'],
  afterCallbacks: [] as Array<() => Promise<void> | void>,
}))

vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server')
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      h.afterCallbacks.push(cb)
    },
  }
})

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        not: async () => ({ data: [], error: null }),
      }),
    }),
  }),
}))

vi.mock('@/lib/whatsapp/webhook-app-secrets', () => ({
  getWebhookAppSecrets: async () => h.secrets,
}))

vi.mock('@/lib/whatsapp/webhook-signature', () => ({
  verifyMetaWebhookSignature: (...args: unknown[]) => h.verify(...args),
}))

vi.mock('@/lib/meta/webhook', () => ({
  processMetaWebhookPayload: vi.fn(),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (value: string) => value,
}))

import { GET, POST } from './route'

describe('GET /api/meta/webhook', () => {
  const prev = process.env.META_WEBHOOK_VERIFY_TOKEN

  afterEach(() => {
    if (prev === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN
    else process.env.META_WEBHOOK_VERIFY_TOKEN = prev
  })

  it('returns the challenge when the verify token matches', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me'
    const url =
      'https://cloud.vachat.in/api/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123'
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('abc123')
  })

  it('rejects a bad verify token', async () => {
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'verify-me'
    const url =
      'https://cloud.vachat.in/api/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc123'
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
  })
})

describe('POST /api/meta/webhook', () => {
  afterEach(() => {
    h.verify.mockReset()
    h.afterCallbacks = []
  })

  it('fail-closes when HMAC verification fails', async () => {
    h.verify.mockReturnValue(false)
    const res = await POST(
      new Request('https://cloud.vachat.in/api/meta/webhook', {
        method: 'POST',
        headers: { 'x-hub-signature-256': 'sha256=deadbeef' },
        body: '{"object":"page"}',
      }),
    )
    expect(res.status).toBe(401)
    expect(h.afterCallbacks).toHaveLength(0)
  })
})
