import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  CallActionError,
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
