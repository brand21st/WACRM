import { Queue, type QueueOptions } from 'bullmq'

import type {
  AiChatReplyJob,
  AiVoiceInboundJob,
  CallRecordingJob,
} from '@/lib/queue/jobs'
import { DEFAULT_JOB_OPTIONS, QUEUE_NAMES } from '@/lib/queue/names'
import { getBullmqConnection } from '@/lib/queue/redis'

type QueueMap = {
  aiChatReply: Queue
  aiVoiceInbound: Queue
  callRecording: Queue
}

let queues: QueueMap | null = null

export function isDuplicateJobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /already exists/i.test(msg)
}

function queueOptions(): QueueOptions | null {
  const connection = getBullmqConnection()
  if (!connection) return null
  return {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  }
}

function getQueues(): QueueMap | null {
  if (queues) return queues
  const opts = queueOptions()
  if (!opts) return null
  queues = {
    aiChatReply: new Queue(QUEUE_NAMES.aiChatReply, opts),
    aiVoiceInbound: new Queue(QUEUE_NAMES.aiVoiceInbound, opts),
    callRecording: new Queue(QUEUE_NAMES.callRecording, opts),
  }
  return queues
}

/** Test-only: drop cached Queue instances. */
export function resetQueuesForTests(): void {
  queues = null
}

async function addJob(
  queue: Queue | undefined,
  name: string,
  data: object,
  jobId: string,
): Promise<boolean> {
  if (!queue) return false
  try {
    await queue.add(name, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId,
    })
    // Duplicate custom jobIds are ignored without throwing.
    return true
  } catch (err) {
    if (isDuplicateJobError(err)) return true
    console.error(
      `[queue] enqueue ${name} failed:`,
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

/**
 * Enqueue a chat AI reply (text or image). Returns false when Redis is
 * unset or the add fails — callers fall back to inline dispatch.
 * A Meta webhook replay that hits the same messageId is success.
 */
export async function enqueueAiChatReply(
  data: AiChatReplyJob,
): Promise<boolean> {
  return addJob(
    getQueues()?.aiChatReply,
    QUEUE_NAMES.aiChatReply,
    data,
    data.messageId,
  )
}

/**
 * Enqueue inbound voice STT + spoken reply. Returns false when Redis
 * is unset or the add fails — callers fall back to Postgres jobs.
 */
export async function enqueueAiVoiceInbound(
  data: AiVoiceInboundJob,
): Promise<boolean> {
  return addJob(
    getQueues()?.aiVoiceInbound,
    QUEUE_NAMES.aiVoiceInbound,
    data,
    data.messageId,
  )
}

/**
 * Enqueue post-call STT + summary. Returns false when Redis is unset
 * or the add fails — callers fall back to in-process processing.
 */
export async function enqueueCallRecording(
  data: CallRecordingJob,
): Promise<boolean> {
  return addJob(
    getQueues()?.callRecording,
    QUEUE_NAMES.callRecording,
    data,
    data.callId,
  )
}
