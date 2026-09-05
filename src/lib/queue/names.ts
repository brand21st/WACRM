import type { DefaultJobOptions } from 'bullmq'

export const QUEUE_NAMES = {
  aiChatReply: 'ai-chat-reply',
  aiVoiceInbound: 'ai-voice-inbound',
  callRecording: 'call-recording',
  knowledgeScrape: 'knowledge-scrape',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

export const WORKER_CONCURRENCY = {
  aiChatReply: 8,
  aiVoiceInbound: 4,
  callRecording: 2,
  knowledgeScrape: 2,
} as const

export const WORKER_LOCK_MS = {
  aiChatReply: 120_000,
  aiVoiceInbound: 180_000,
  callRecording: 180_000,
  knowledgeScrape: 300_000,
} as const
