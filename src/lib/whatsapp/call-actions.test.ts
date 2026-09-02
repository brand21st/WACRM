import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CallActionError,
  acceptCall,
  claimRingingCall,
  mapCallingEnableError,
  __setCallActionsAdminForTests,
} from './call-actions'

const h = vi.hoisted(() => ({
  callAction: vi.fn(),
  updateCallSettings: vi.fn(),
  decrypt: vi.fn(() => 'token'),
}))

vi.mock('@/lib/whatsapp/meta-api', () => ({
  callAction: h.callAction,
  updateCallSettings: h.updateCallSettings,
  MetaApiError: class MetaApiError extends Error {
    code?: number
    constructor(message: string, opts?: { code?: number }) {
      super(message)
      this.code = opts?.code
    }
  },
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: h.decrypt,
}))

function mockAdmin(opts: {
  claimResult?: Record<string, unknown> | null
  claimError?: unknown
}) {
  const client = {
    from: (table: string) => {
      if (table !== 'calls') {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => ({
                    data: opts.claimResult ?? null,
                    error: opts.claimError ?? null,
                  }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
  __setCallActionsAdminForTests(client as never)
  return client
}

describe('claimRingingCall', () => {
  beforeEach(() => {
    __setCallActionsAdminForTests(null)
  })

  it('returns the claimed row when the update matches ringing', async () => {
    const row = {
      id: 'c1',
      account_id: 'acc-1',
      status: 'connecting',
      answered_by: 'user-1',
    }
    mockAdmin({ claimResult: row })
    const claimed = await claimRingingCall('acc-1', 'c1', 'user-1')
    expect(claimed).toMatchObject(row)
  })

  it('returns null when another agent already claimed (zero rows)', async () => {
    mockAdmin({ claimResult: null })
    const claimed = await claimRingingCall('acc-1', 'c1', 'user-2')
    expect(claimed).toBeNull()
  })
})

describe('mapCallingEnableError', () => {
  it('maps Meta 138015 and 138018', () => {
    expect(mapCallingEnableError(138015, 'x')).toMatch(/2,000/)
    expect(mapCallingEnableError(138018, 'x')).toMatch(/calls/)
    expect(mapCallingEnableError(undefined, 'fallback')).toBe('fallback')
  })
})

describe('CallActionError', () => {
  it('carries HTTP status', () => {
    const err = new CallActionError(409, 'Call already claimed', 'already_claimed')
    expect(err.status).toBe(409)
    expect(err.code).toBe('already_claimed')
  })
})

function mockAcceptAdmin(opts: {
  call: Record<string, unknown>
  settings: Record<string, unknown>
}) {
  const connecting = { ...opts.call, status: 'connecting', answered_by: 'user-1' }
  const client = {
    from(table: string) {
      if (table === 'calls') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: connecting, error: null }),
              }),
            }),
          }),
          update: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({
                  data: { ...connecting, status: 'in_progress' },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'calling_settings') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.settings, error: null }),
            }),
          }),
        }
      }
      if (table === 'whatsapp_config') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { phone_number_id: 'pn-1', access_token: 'enc' },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === 'messages') {
        return {
          update: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ error: null }),
            }),
          }),
        }
      }
      if (table === 'conversations') {
        return {
          update: () => ({
            eq: () => Promise.resolve({ error: null }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  __setCallActionsAdminForTests(client as never)
}

describe('acceptCall recording', () => {
  beforeEach(() => {
    h.callAction.mockReset()
    h.callAction.mockResolvedValue(undefined)
    __setCallActionsAdminForTests(null)
  })

  const call = {
    id: 'c1',
    account_id: 'acc-1',
    meta_call_id: 'wacid.ABC',
    conversation_id: 'conv-1',
    answered_by: 'user-1',
  }

  it('sends Meta recording when enabled', async () => {
    mockAcceptAdmin({
      call,
      settings: {
        recording_enabled: true,
        recording_purpose: 'quality and training purposes',
        recording_announcement_language: 'en_US',
        live_ai_answer: 'off',
      },
    })
    await acceptCall({ accountId: 'acc-1', userId: 'user-1', callId: 'c1', sdp: 'v=0' })
    expect(h.callAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'accept',
        recording: {
          status: 'ENABLED',
          purpose: 'quality and training purposes',
          announcement_language: 'en_US',
        },
      }),
    )
  })

  it('omits recording when disabled', async () => {
    mockAcceptAdmin({
      call,
      settings: {
        recording_enabled: false,
        recording_purpose: 'quality and training purposes',
        recording_announcement_language: 'en_US',
        live_ai_answer: 'off',
      },
    })
    await acceptCall({ accountId: 'acc-1', userId: 'user-1', callId: 'c1', sdp: 'v=0' })
    expect(h.callAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'accept', recording: undefined }),
    )
  })

  it('does not hit Graph when recording is on but purpose is missing', async () => {
    mockAcceptAdmin({
      call,
      settings: {
        recording_enabled: true,
        recording_purpose: '   ',
        recording_announcement_language: 'en_US',
        live_ai_answer: 'off',
      },
    })
    await expect(
      acceptCall({ accountId: 'acc-1', userId: 'user-1', callId: 'c1', sdp: 'v=0' }),
    ).rejects.toMatchObject({ status: 400, code: 'recording_purpose' })
    expect(h.callAction).not.toHaveBeenCalled()
  })
})

