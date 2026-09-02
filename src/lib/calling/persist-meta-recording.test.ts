import { createHash } from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  callRecordingMessageId,
  persistMetaCallRecording,
  recordingHashesMatch,
} from './persist-meta-recording'
import { DEFAULT_RECORDING_PURPOSE } from './settings'

const AUDIO = Buffer.from('ogg-bytes')
const SHA = createHash('sha256').update(AUDIO).digest('base64')

function fakeDb(opts: {
  call: Record<string, unknown> | null
  settings?: Record<string, unknown>
}) {
  const uploads: Array<{ bucket: string; path: string; contentType: string }> = []
  const callUpdates: Record<string, unknown>[] = []
  const messageUpserts: Record<string, unknown>[] = []
  let currentTable = ''

  const storageFrom = (bucket: string) => ({
    upload: async (path: string, _body: Buffer, options: { contentType: string }) => {
      uploads.push({ bucket, path, contentType: options.contentType })
      return { error: null }
    },
    createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/rec.ogg' } }),
    getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.example/rec.ogg' } }),
  })

  const db = {
    storage: { from: storageFrom },
    from(table: string) {
      currentTable = table
      const chain: Record<string, unknown> = {}
      const self = () => chain
      chain.select = () => self()
      chain.eq = () => self()
      chain.is = () => self()
      chain.maybeSingle = async () => {
        if (currentTable === 'calls') {
          return { data: opts.call, error: null }
        }
        if (currentTable === 'calling_settings') {
          return {
            data: opts.settings ?? {
              account_id: 'acc-1',
              recording_enabled: true,
              recording_purpose: DEFAULT_RECORDING_PURPOSE,
              recording_announcement_language: 'en_US',
              transcribe_enabled: false,
              ai_enabled: false,
              live_ai_answer: 'off',
            },
            error: null,
          }
        }
        return { data: { id: opts.call?.id }, error: null }
      }
      chain.update = (row: Record<string, unknown>) => {
        if (currentTable === 'calls') callUpdates.push(row)
        return self()
      }
      chain.upsert = (row: Record<string, unknown>) => {
        messageUpserts.push(row)
        return Promise.resolve({ error: null })
      }
      return chain
    },
  }

  return { db, uploads, callUpdates, messageUpserts }
}

describe('persistMetaCallRecording', () => {
  it('builds a replay-safe audio message id', () => {
    expect(callRecordingMessageId('wacid.ABC')).toBe('rec-wacid.ABC')
  })

  it('accepts Meta base64 sha256', () => {
    expect(recordingHashesMatch(AUDIO, SHA)).toBe(true)
    expect(recordingHashesMatch(AUDIO, 'nope')).toBe(false)
    expect(recordingHashesMatch(AUDIO, null)).toBe(true)
  })

  it('stores ogg, attaches an audio bubble, and skips a second pass', async () => {
    const first = fakeDb({
      call: {
        id: 'call-1',
        account_id: 'acc-1',
        conversation_id: 'conv-1',
        meta_call_id: 'wacid.ABC',
        recording_key: null,
      },
    })
    const download = vi.fn(async () => ({
      buffer: AUDIO,
      contentType: 'audio/ogg; codecs=opus',
      mimeType: 'audio/ogg; codecs=opus',
      fileSize: AUDIO.byteLength,
    }))

    const saved = await persistMetaCallRecording({
      db: first.db as never,
      accountId: 'acc-1',
      metaCallId: 'wacid.ABC',
      accessToken: 'token',
      audio: { id: 'media-1', sha256: SHA, mime_type: 'audio/ogg; codecs=opus' },
      download,
    })

    expect(saved?.callId).toBe('call-1')
    expect(first.uploads.some((u) => u.bucket === 'call-recordings' && u.contentType === 'audio/ogg')).toBe(
      true,
    )
    expect(first.callUpdates[0]).toMatchObject({
      recording_key: 'account-acc-1/call-1.ogg',
      consent_announced: true,
    })
    expect(first.messageUpserts[0]).toMatchObject({
      conversation_id: 'conv-1',
      sender_type: 'bot',
      content_type: 'audio',
      message_id: 'rec-wacid.ABC',
      media_url: 'https://cdn.example/rec.ogg',
    })

    const replay = fakeDb({
      call: {
        id: 'call-1',
        account_id: 'acc-1',
        conversation_id: 'conv-1',
        meta_call_id: 'wacid.ABC',
        recording_key: 'account-acc-1/call-1.ogg',
      },
    })
    const again = await persistMetaCallRecording({
      db: replay.db as never,
      accountId: 'acc-1',
      metaCallId: 'wacid.ABC',
      accessToken: 'token',
      audio: { id: 'media-1', sha256: SHA, mime_type: 'audio/ogg' },
      download,
    })
    expect(again).toBeNull()
    expect(download).toHaveBeenCalledTimes(1)
    expect(replay.uploads).toHaveLength(0)
    expect(replay.messageUpserts).toHaveLength(0)
  })

  it('does not store when sha256 does not match', async () => {
    const { db, uploads } = fakeDb({
      call: {
        id: 'call-1',
        account_id: 'acc-1',
        conversation_id: 'conv-1',
        meta_call_id: 'wacid.ABC',
        recording_key: null,
      },
    })
    const result = await persistMetaCallRecording({
      db: db as never,
      accountId: 'acc-1',
      metaCallId: 'wacid.ABC',
      accessToken: 'token',
      audio: { id: 'media-1', sha256: 'bad' },
      download: async () => ({
        buffer: AUDIO,
        contentType: 'audio/ogg',
        mimeType: 'audio/ogg',
        fileSize: AUDIO.byteLength,
      }),
    })
    expect(result).toBeNull()
    expect(uploads).toHaveLength(0)
  })
})
