export const QUEUE_NAMES = {
  aiChatReply: 'ai-chat-reply',
  aiVoiceInbound: 'ai-voice-inbound',
  callRecording: 'call-recording',
} as const

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES]

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 15_000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
}

export const WORKER_CONCURRENCY = {
  aiChatReply: 8,
  aiVoiceInbound: 4,
  callRecording: 2,
} as const

export const WORKER_LOCK_MS = {
  aiChatReply: 120_000,
  aiVoiceInbound: 180_000,
  callRecording: 180_000,
} as const
