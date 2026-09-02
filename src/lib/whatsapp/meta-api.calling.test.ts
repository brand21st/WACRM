import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callAction } from './meta-api'

let captured: { url: string; body: Record<string, unknown> } | null = null

function okFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    captured = {
      url: String(url),
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {},
    }
    return {
      ok: true,
      json: async () => ({ success: true }),
    } as Response
  })
}

const BASE = {
  phoneNumberId: 'pn-1',
  accessToken: 'token',
  callId: 'wacid.ABC',
  session: { sdpType: 'answer' as const, sdp: 'v=0' },
}

describe('callAction recording payload', () => {
  beforeEach(() => {
    captured = null
    vi.stubGlobal('fetch', okFetch())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('includes recording on accept and omits it on pre_accept', async () => {
    await callAction({
      ...BASE,
      action: 'accept',
      recording: {
        status: 'ENABLED',
        purpose: 'quality and training purposes',
        announcement_language: 'en_US',
      },
    })
    expect(captured?.body).toMatchObject({
      messaging_product: 'whatsapp',
      call_id: 'wacid.ABC',
      action: 'accept',
      session: { sdp_type: 'answer', sdp: 'v=0' },
      recording: {
        status: 'ENABLED',
        purpose: 'quality and training purposes',
        announcement_language: 'en_US',
      },
    })

    captured = null
    await callAction({
      ...BASE,
      action: 'pre_accept',
    })
    expect(captured?.body.action).toBe('pre_accept')
    expect(captured?.body).not.toHaveProperty('recording')
  })
})
