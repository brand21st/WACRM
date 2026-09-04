import { describe, expect, it, vi } from 'vitest'

const constructed: Array<{
  name: string
  concurrency: number
  lockDuration: number
}> = []

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(
      name: string,
      _processor: unknown,
      opts: { concurrency: number; lockDuration: number },
    ) {
      constructed.push({
        name,
        concurrency: opts.concurrency,
        lockDuration: opts.lockDuration,
      })
    }
  },
}))

vi.mock('@/lib/queue/processors/ai-chat-reply', () => ({
  processAiChatReply: vi.fn(),
}))
vi.mock('@/lib/queue/processors/ai-voice-inbound', () => ({
  processAiVoiceInbound: vi.fn(),
}))
vi.mock('@/lib/queue/processors/call-recording', () => ({
  processCallRecordingJob: vi.fn(),
}))

import { createQueueWorkers } from './create-workers'
import { QUEUE_NAMES, WORKER_CONCURRENCY, WORKER_LOCK_MS } from './names'

describe('createQueueWorkers', () => {
  it('starts one worker per queue with planned concurrency and lock', () => {
    constructed.length = 0
    const workers = createQueueWorkers({ host: '127.0.0.1', port: 6379 })
    expect(workers).toHaveLength(3)
    expect(constructed.map((w) => w.name)).toEqual([
      QUEUE_NAMES.aiChatReply,
      QUEUE_NAMES.aiVoiceInbound,
      QUEUE_NAMES.callRecording,
    ])
    expect(constructed[0]).toMatchObject({
      concurrency: WORKER_CONCURRENCY.aiChatReply,
      lockDuration: WORKER_LOCK_MS.aiChatReply,
    })
    expect(constructed[1]).toMatchObject({
      concurrency: WORKER_CONCURRENCY.aiVoiceInbound,
      lockDuration: WORKER_LOCK_MS.aiVoiceInbound,
    })
    expect(constructed[2]).toMatchObject({
      concurrency: WORKER_CONCURRENCY.callRecording,
      lockDuration: WORKER_LOCK_MS.callRecording,
    })
  })
})
