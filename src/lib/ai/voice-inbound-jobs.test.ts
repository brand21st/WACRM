import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const transcribeInboundVoiceNote = vi.fn()
const dispatchInboundToAiReply = vi.fn()

vi.mock('./transcribe-inbound', () => ({
  transcribeInboundVoiceNote: (...args: unknown[]) =>
    transcribeInboundVoiceNote(...args),
}))

vi.mock('./auto-reply', () => ({
  dispatchInboundToAiReply: (...args: unknown[]) =>
    dispatchInboundToAiReply(...args),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import {
  drainVoiceInboundJobs,
  enqueueVoiceInboundJob,
  reclaimStaleVoiceJobs,
  VOICE_JOB_STALE_MS,
} from './voice-inbound-jobs'

interface JobRow {
  id: string
  account_id: string
  conversation_id: string
  contact_id: string
  message_id: string
  user_id: string
  meta_message_id: string
  media_id: string
  mime_type: string | null
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempts: number
  run_at: string
  error: string | null
  updated_at: string
}

const SAMPLE_JOB: JobRow = {
  id: 'job-1',
  account_id: 'acc-1',
  conversation_id: 'conv-1',
  contact_id: 'contact-1',
  message_id: 'msg-1',
  user_id: 'user-1',
  meta_message_id: 'wamid.1',
  media_id: 'media-1',
  mime_type: 'audio/ogg',
  status: 'pending',
  attempts: 0,
  run_at: new Date(0).toISOString(),
  error: null,
  updated_at: new Date(0).toISOString(),
}

function makeDb(state: {
  jobs: JobRow[]
  insertError?: { code?: string; message: string } | null
  messageText?: string | null
  token?: string | null
  claimLost?: boolean
}) {
  const jobs = state.jobs
  const updates: Array<Record<string, unknown>> = []

  function matches(row: JobRow, filters: Array<[string, string, unknown]>) {
    return filters.every(([op, col, val]) => {
      const current = (row as Record<string, unknown>)[col]
      if (op === 'eq') return current === val
      if (op === 'lt') return String(current) < String(val)
      if (op === 'lte') return String(current) <= String(val)
      return true
    })
  }

  function from(table: string) {
    const filters: Array<[string, string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    let op: 'select' | 'update' | 'insert' = 'select'
    let insertRow: Record<string, unknown> | null = null

    const builder: Record<string, unknown> = {}
    const self = () => builder

    const execute = async () => {
      if (table === 'voice_inbound_jobs') {
        if (op === 'insert') {
          if (state.insertError) return { data: null, error: state.insertError }
          jobs.push({
            ...SAMPLE_JOB,
            ...(insertRow as Partial<JobRow>),
            id: `job-${jobs.length + 1}`,
            status: 'pending',
            attempts: 0,
          } as JobRow)
          return { data: null, error: null }
        }
        const hit = jobs.filter((row) => matches(row, filters))
        if (op === 'update' && patch) {
          updates.push({ ...patch, filters: [...filters] })
          if (state.claimLost && patch.status === 'running') {
            return { data: null, error: null }
          }
          for (const row of hit) Object.assign(row, patch)
          return { data: hit[0] ? { id: hit[0].id } : null, error: null }
        }
        return { data: hit, error: null }
      }
      if (table === 'messages') {
        if (op === 'update') return { data: null, error: null }
        return {
          data: { id: 'msg-1', content_text: state.messageText ?? null },
          error: null,
        }
      }
      if (table === 'conversations') {
        return { data: null, error: null }
      }
      if (table === 'whatsapp_config') {
        return {
          data: state.token === null ? null : { access_token: state.token ?? 'enc' },
          error: null,
        }
      }
      throw new Error(`unexpected table: ${table}`)
    }

    builder.select = vi.fn(self)
    builder.insert = vi.fn((row: Record<string, unknown>) => {
      op = 'insert'
      insertRow = row
      return {
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          execute().then(resolve, reject),
      }
    })
    builder.update = vi.fn((next: Record<string, unknown>) => {
      op = 'update'
      patch = next
      return builder
    })
    builder.eq = vi.fn((col: string, val: unknown) => {
      filters.push(['eq', col, val])
      return builder
    })
    builder.lt = vi.fn((col: string, val: unknown) => {
      filters.push(['lt', col, val])
      return builder
    })
    builder.lte = vi.fn((col: string, val: unknown) => {
      filters.push(['lte', col, val])
      return builder
    })
    builder.order = vi.fn(self)
    builder.limit = vi.fn(() => ({
      maybeSingle: builder.maybeSingle,
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => execute().then(resolve, reject),
    }))
    builder.maybeSingle = vi.fn(async () => {
      const result = await execute()
      const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data
      return { data, error: result.error }
    })
    builder.then = (
      resolve: (v: unknown) => unknown,
      reject?: (e: unknown) => unknown,
    ) => execute().then(resolve, reject)

    return builder
  }

  return {
    db: { from } as unknown as SupabaseClient,
    jobs,
    updates,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  transcribeInboundVoiceNote.mockResolvedValue('hello from the customer')
  dispatchInboundToAiReply.mockResolvedValue(undefined)
})

describe('enqueueVoiceInboundJob', () => {
  it('inserts a pending row', async () => {
    const { db, jobs } = makeDb({ jobs: [] })
    const ok = await enqueueVoiceInboundJob({
      db,
      accountId: 'acc-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      messageId: 'msg-1',
      userId: 'user-1',
      metaMessageId: 'wamid.1',
      mediaId: 'media-1',
      mimeType: 'audio/ogg',
    })
    expect(ok).toBe(true)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({
      account_id: 'acc-1',
      message_id: 'msg-1',
      status: 'pending',
    })
  })

  it('treats a unique violation as already queued', async () => {
    const { db } = makeDb({
      jobs: [],
      insertError: { code: '23505', message: 'duplicate' },
    })
    await expect(
      enqueueVoiceInboundJob({
        db,
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        messageId: 'msg-1',
        userId: 'user-1',
        metaMessageId: 'wamid.1',
        mediaId: 'media-1',
      }),
    ).resolves.toBe(true)
  })

  it('returns false when insert fails for another reason', async () => {
    const { db } = makeDb({
      jobs: [],
      insertError: { message: 'db down' },
    })
    await expect(
      enqueueVoiceInboundJob({
        db,
        accountId: 'acc-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        messageId: 'msg-1',
        userId: 'user-1',
        metaMessageId: 'wamid.1',
        mediaId: 'media-1',
      }),
    ).resolves.toBe(false)
  })
})

describe('drainVoiceInboundJobs', () => {
  it('claims a pending job, transcribes, replies, and completes', async () => {
    const { db, jobs } = makeDb({ jobs: [{ ...SAMPLE_JOB }] })
    const result = await drainVoiceInboundJobs(db, 20)
    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(transcribeInboundVoiceNote).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acc-1',
        mediaId: 'media-1',
        accessToken: 'plain:enc',
        contentType: 'audio',
      }),
    )
    expect(dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundContentType: 'audio',
        inboundMetaMessageId: 'wamid.1',
        configOwnerUserId: 'user-1',
      }),
    )
    expect(jobs[0].status).toBe('completed')
  })

  it('skips STT when the message already has a transcript', async () => {
    const { db } = makeDb({
      jobs: [{ ...SAMPLE_JOB }],
      messageText: 'already transcribed',
    })
    await drainVoiceInboundJobs(db, 20)
    expect(transcribeInboundVoiceNote).not.toHaveBeenCalled()
    expect(dispatchInboundToAiReply).toHaveBeenCalled()
  })

  it('does not process a job another worker already claimed', async () => {
    const { db } = makeDb({ jobs: [{ ...SAMPLE_JOB }], claimLost: true })
    const result = await drainVoiceInboundJobs(db, 20)
    expect(result).toEqual({ processed: 0, failed: 0 })
    expect(transcribeInboundVoiceNote).not.toHaveBeenCalled()
  })

  it('still auto-replies when transcription is empty', async () => {
    transcribeInboundVoiceNote.mockResolvedValue(null)
    const { db, jobs } = makeDb({ jobs: [{ ...SAMPLE_JOB }] })
    const result = await drainVoiceInboundJobs(db, 20)
    expect(result).toEqual({ processed: 1, failed: 0 })
    expect(dispatchInboundToAiReply).toHaveBeenCalledWith(
      expect.objectContaining({ inboundContentType: 'audio' }),
    )
    expect(jobs[0].status).toBe('completed')
  })

  it('reschedules a media error so BullMQ/cron can retry', async () => {
    transcribeInboundVoiceNote.mockRejectedValue(new Error('whatsapp access token unavailable'))
    const { db, jobs } = makeDb({ jobs: [{ ...SAMPLE_JOB }] })
    await drainVoiceInboundJobs(db, 20)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].attempts).toBe(1)
    expect(new Date(jobs[0].run_at).getTime()).toBeGreaterThan(Date.now())
  })
})

describe('reclaimStaleVoiceJobs', () => {
  it('returns abandoned running jobs to pending', async () => {
    const stale = new Date(Date.now() - VOICE_JOB_STALE_MS - 1_000).toISOString()
    const { db, jobs } = makeDb({
      jobs: [{ ...SAMPLE_JOB, status: 'running', updated_at: stale }],
    })
    await reclaimStaleVoiceJobs(db)
    expect(jobs[0].status).toBe('pending')
    expect(jobs[0].error).toBe('reclaimed stale running job')
  })
})
