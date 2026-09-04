import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleCallsWebhook } from './call-webhook'
import { encodeCallPreview } from '@/lib/calls/preview'

const h = vi.hoisted(() => ({
  findExistingContact: vi.fn(),
  isUniqueViolation: vi.fn(() => false),
  persistRecording: vi.fn(),
  processRecording: vi.fn(),
  enqueueCallRecording: vi.fn(),
  decrypt: vi.fn((value: string) => `plain:${value}`),
  calls: {
    existing: null as { id: string; status: string } | null,
    inserted: { id: 'call-row-1' } as { id: string } | null,
    insertError: null as { code?: string } | null,
    terminateRow: null as {
      id: string
      status: string
      conversation_id: string
      duration_seconds: number | null
    } | null,
  },
  configRows: [{ account_id: 'acc-1', user_id: 'user-1', access_token: 'enc' }] as Array<{
    account_id: string
    user_id: string
    access_token?: string
  }>,
  messageUpserts: [] as Record<string, unknown>[],
  rpcCalls: [] as { name: string; args: Record<string, unknown> }[],
  callUpdates: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/contacts/dedupe', () => ({
  findExistingContact: h.findExistingContact,
  isUniqueViolation: h.isUniqueViolation,
}))

vi.mock('@/lib/calling/persist-meta-recording', () => ({
  persistMetaCallRecording: h.persistRecording,
}))

vi.mock('@/lib/calling/process-recording', () => ({
  processCallRecording: h.processRecording,
}))

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueCallRecording: h.enqueueCallRecording,
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: h.decrypt,
}))

function chain(result: unknown) {
  const self: Record<string, unknown> = {}
  const methods = [
    'select',
    'eq',
    'order',
    'limit',
    'maybeSingle',
    'single',
    'insert',
    'update',
    'upsert',
  ]
  for (const m of methods) {
    self[m] = (...args: unknown[]) => {
      if (m === 'insert' && currentTable === 'calls') {
        return {
          select: () => ({
            maybeSingle: async () => ({
              data: h.calls.inserted,
              error: h.calls.insertError,
            }),
          }),
        }
      }
      if (m === 'upsert' && currentTable === 'messages') {
        h.messageUpserts.push(args[0] as Record<string, unknown>)
        return Promise.resolve({ error: null })
      }
      if (m === 'update') {
        if (currentTable === 'calls') {
          h.callUpdates.push(args[0] as Record<string, unknown>)
        }
        return chain(result)
      }
      if (m === 'maybeSingle' || m === 'single' || m === 'limit') {
        return Promise.resolve(result)
      }
      return chain(result)
    }
  }
  return self
}

let currentTable = ''

const db = {
  from(table: string) {
    currentTable = table
    switch (table) {
      case 'whatsapp_config':
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({ data: h.configRows, error: null }),
          }),
        }
      case 'calls':
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: currentSelectIsTerminate
                    ? h.calls.terminateRow
                    : h.calls.existing,
                  error: null,
                }),
            }),
          }),
          insert: (row: unknown) => ({
            select: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: h.calls.inserted,
                  error: h.calls.insertError,
                }),
            }),
          }),
          update: (row: Record<string, unknown>) => {
            h.callUpdates.push(row)
            return {
              eq: () => Promise.resolve({ error: null }),
            }
          },
        }
      case 'contacts':
        return {
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'contact-new' }, error: null }),
            }),
          }),
        }
      case 'conversations':
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () =>
                    Promise.resolve({
                      data: [{ id: 'conv-1' }],
                      error: null,
                    }),
                }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: 'conv-1' }, error: null }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        }
      case 'messages':
        return {
          upsert: (row: Record<string, unknown>) => {
            h.messageUpserts.push(row)
            return Promise.resolve({ error: null })
          },
          update: () => ({
            eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
          }),
        }
      default:
        throw new Error(`unexpected table ${table}`)
    }
  },
  rpc(name: string, args: Record<string, unknown>) {
    h.rpcCalls.push({ name, args })
    return Promise.resolve({ error: null })
  },
}

let currentSelectIsTerminate = false

describe('handleCallsWebhook', () => {
  beforeEach(() => {
    h.findExistingContact.mockResolvedValue({
      id: 'contact-1',
      name: 'Ada',
      phone: '15551230000',
    })
    h.calls.existing = null
    h.calls.inserted = { id: 'call-row-1' }
    h.calls.insertError = null
    h.calls.terminateRow = null
    h.messageUpserts = []
    h.rpcCalls = []
    h.callUpdates = []
    h.persistRecording.mockReset()
    h.processRecording.mockReset()
    h.enqueueCallRecording.mockReset()
    h.enqueueCallRecording.mockResolvedValue(true)
    currentSelectIsTerminate = false
  })

  it('persists a connect event with SDP and a call bubble', async () => {
    await handleCallsWebhook(
      {
        metadata: {
          phone_number_id: 'pn-1',
          display_phone_number: '13175551399',
        },
        contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
        calls: [
          {
            id: 'wacid.ABC',
            event: 'connect',
            timestamp: '1700000000',
            session: { sdp_type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0' },
          },
        ],
      },
      db as never,
    )

    expect(h.messageUpserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      content_type: 'call',
      content_text: encodeCallPreview('ringing'),
      message_id: 'wacid.ABC',
    })
    expect(h.rpcCalls[0]).toMatchObject({
      name: 'bump_conversation_on_inbound',
    })
  })

  it('ignores a replayed connect when the call already exists', async () => {
    h.calls.existing = { id: 'call-row-1', status: 'in_progress' }
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        contacts: [{ wa_id: '15551230000', profile: { name: 'Ada' } }],
        calls: [{ id: 'wacid.ABC', event: 'connect' }],
      },
      db as never,
    )
    expect(h.messageUpserts).toHaveLength(0)
  })

  it('marks a still-ringing call as missed on terminate', async () => {
    currentSelectIsTerminate = true
    h.calls.existing = { id: 'call-row-1', status: 'ringing' }
    h.calls.terminateRow = {
      id: 'call-row-1',
      status: 'ringing',
      conversation_id: 'conv-1',
      duration_seconds: null,
    }
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        calls: [
          {
            id: 'wacid.ABC',
            event: 'terminate',
            status: 'Failed',
            duration: 0,
            timestamp: '1700000100',
          },
        ],
      },
      db as never,
    )
    expect(h.callUpdates[0]).toMatchObject({ status: 'missed' })
  })

  it('keeps rejected when terminate arrives after the agent declined', async () => {
    currentSelectIsTerminate = true
    h.calls.terminateRow = {
      id: 'call-row-1',
      status: 'rejected',
      conversation_id: 'conv-1',
      duration_seconds: null,
    }
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        calls: [{ id: 'wacid.ABC', event: 'terminate', status: 'Completed' }],
      },
      db as never,
    )
    expect(h.callUpdates[0]).toMatchObject({ status: 'rejected' })
  })

  it('downloads and attaches audio on call_recording_available', async () => {
    h.persistRecording.mockResolvedValue({
      callId: 'call-row-1',
      settings: { recording_enabled: true },
    })
    h.processRecording.mockResolvedValue(undefined)
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        calls: [
          {
            id: 'wacid.ABC',
            event: 'call_recording_available',
            call_recording: {
              type: 'audio',
              audio: {
                id: 'media-1',
                sha256: 'abc',
                mime_type: 'audio/ogg; codecs=opus',
              },
            },
          },
        ],
      },
      db as never,
    )
    expect(h.persistRecording).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        metaCallId: 'wacid.ABC',
        accessToken: 'plain:enc',
        audio: { id: 'media-1', sha256: 'abc', mime_type: 'audio/ogg; codecs=opus' },
      }),
    )
    expect(h.enqueueCallRecording).toHaveBeenCalledWith({
      accountId: 'acc-1',
      callId: 'call-row-1',
    })
    expect(h.processRecording).not.toHaveBeenCalled()
  })

  it('falls back to in-process recording work when Redis enqueue fails', async () => {
    h.persistRecording.mockResolvedValue({
      callId: 'call-row-1',
      settings: { recording_enabled: true },
    })
    h.enqueueCallRecording.mockResolvedValueOnce(false)
    h.processRecording.mockResolvedValue(undefined)
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        calls: [
          {
            id: 'wacid.ABC',
            event: 'call_recording_available',
            call_recording: { audio: { id: 'media-1' } },
          },
        ],
      },
      db as never,
    )
    await Promise.resolve()
    expect(h.processRecording).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acc-1', callId: 'call-row-1' }),
    )
  })

  it('does not persist a replayed recording when persist returns null', async () => {
    h.persistRecording.mockResolvedValue(null)
    await handleCallsWebhook(
      {
        metadata: { phone_number_id: 'pn-1' },
        calls: [
          {
            id: 'wacid.ABC',
            event: 'call_recording_available',
            call_recording: { audio: { id: 'media-1' } },
          },
        ],
      },
      db as never,
    )
    expect(h.persistRecording).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(h.enqueueCallRecording).not.toHaveBeenCalled()
    expect(h.processRecording).not.toHaveBeenCalled()
  })
})
