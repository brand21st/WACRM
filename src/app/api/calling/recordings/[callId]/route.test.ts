import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  enqueueCallRecording: vi.fn(),
  processCallRecording: vi.fn(),
  afterCallbacks: [] as Array<() => Promise<void> | void>,
  call: {
    id: 'call-1',
    account_id: 'acct-1',
    answered_by: 'user-1',
  } as { id: string; account_id: string; answered_by: string | null } | null,
  uploadError: null as { message: string } | null,
  dbError: null as { message: string } | null,
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return {
    ...actual,
    after: (cb: () => Promise<void> | void) => {
      mocks.afterCallbacks.push(cb)
    },
  }
})

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn(() =>
    Response.json({ error: 'auth failed' }, { status: 403 }),
  ),
}))

vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/rate-limit')>(
    '@/lib/rate-limit',
  )
  return {
    ...actual,
    checkRateLimit: () => ({ success: true }),
    rateLimitResponse: () => Response.json({ error: 'rate' }, { status: 429 }),
  }
})

vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: mocks.call, error: null }),
          }),
        }),
      }),
      update: () => ({
        eq: async () => ({ error: mocks.dbError }),
      }),
    }),
    storage: {
      from: () => ({
        upload: async () => ({ error: mocks.uploadError }),
        createSignedUrl: async () => ({
          data: { signedUrl: 'https://cdn.test/rec.webm' },
        }),
      }),
    },
  }),
}))

vi.mock('@/lib/calling/settings', () => ({
  ensureCallingSettings: async () => ({ recording_enabled: true }),
}))

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueCallRecording: mocks.enqueueCallRecording,
}))

vi.mock('@/lib/calling/process-recording', () => ({
  processCallRecording: mocks.processCallRecording,
}))

import { POST } from './route'

function recordingRequest() {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(128)], { type: 'audio/webm' }))
  return new Request('http://localhost/api/calling/recordings/call-1', {
    method: 'POST',
    body: form,
  })
}

const context = { params: Promise.resolve({ callId: 'call-1' }) }

beforeEach(() => {
  mocks.requireRole.mockResolvedValue({
    accountId: 'acct-1',
    userId: 'user-1',
  })
  mocks.enqueueCallRecording.mockResolvedValue(true)
  mocks.processCallRecording.mockResolvedValue(undefined)
  mocks.afterCallbacks = []
  mocks.call = {
    id: 'call-1',
    account_id: 'acct-1',
    answered_by: 'user-1',
  }
  mocks.uploadError = null
  mocks.dbError = null
})

describe('POST /api/calling/recordings/[callId]', () => {
  it('enqueues post-call processing after storing the file', async () => {
    const res = await POST(recordingRequest(), context)
    expect(res.status).toBe(200)
    expect(mocks.enqueueCallRecording).toHaveBeenCalledWith({
      accountId: 'acct-1',
      callId: 'call-1',
    })
    expect(mocks.afterCallbacks).toHaveLength(0)
    expect(mocks.processCallRecording).not.toHaveBeenCalled()
  })

  it('falls back to after() processing when Redis enqueue fails', async () => {
    mocks.enqueueCallRecording.mockResolvedValueOnce(false)
    const res = await POST(recordingRequest(), context)
    expect(res.status).toBe(200)
    expect(mocks.afterCallbacks).toHaveLength(1)
    await mocks.afterCallbacks[0]()
    expect(mocks.processCallRecording).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', callId: 'call-1' }),
    )
  })

  it('rejects a missing recording', async () => {
    const res = await POST(
      new Request('http://localhost/api/calling/recordings/call-1', {
        method: 'POST',
        body: new FormData(),
      }),
      context,
    )
    expect(res.status).toBe(400)
    expect(mocks.enqueueCallRecording).not.toHaveBeenCalled()
  })
})
