import { Worker, type ConnectionOptions } from 'bullmq'

import { processAiChatReply } from '@/lib/queue/processors/ai-chat-reply'
import { processAiVoiceInbound } from '@/lib/queue/processors/ai-voice-inbound'
import { processCallRecordingJob } from '@/lib/queue/processors/call-recording'
import { processCatalogEmbed } from '@/lib/queue/processors/catalog-embed'
import { processCatalogMetaSync } from '@/lib/queue/processors/catalog-meta-sync'
import { processKnowledgeScrape } from '@/lib/queue/processors/knowledge-scrape'
import {
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  WORKER_LOCK_MS,
} from '@/lib/queue/names'

export function createQueueWorkers(connection: ConnectionOptions): Worker[] {
  return [
    new Worker(
      QUEUE_NAMES.aiChatReply,
      async (job) => {
        await processAiChatReply(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.aiChatReply,
        lockDuration: WORKER_LOCK_MS.aiChatReply,
      },
    ),
    new Worker(
      QUEUE_NAMES.aiVoiceInbound,
      async (job) => {
        await processAiVoiceInbound(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.aiVoiceInbound,
        lockDuration: WORKER_LOCK_MS.aiVoiceInbound,
      },
    ),
    new Worker(
      QUEUE_NAMES.callRecording,
      async (job) => {
        await processCallRecordingJob(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.callRecording,
        lockDuration: WORKER_LOCK_MS.callRecording,
      },
    ),
    new Worker(
      QUEUE_NAMES.knowledgeScrape,
      async (job) => {
        await processKnowledgeScrape(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.knowledgeScrape,
        lockDuration: WORKER_LOCK_MS.knowledgeScrape,
      },
    ),
    new Worker(
      QUEUE_NAMES.catalogMetaSync,
      async (job) => {
        await processCatalogMetaSync(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.catalogMetaSync,
        lockDuration: WORKER_LOCK_MS.catalogMetaSync,
      },
    ),
    new Worker(
      QUEUE_NAMES.catalogEmbed,
      async (job) => {
        await processCatalogEmbed(job.data)
      },
      {
        connection,
        concurrency: WORKER_CONCURRENCY.catalogEmbed,
        lockDuration: WORKER_LOCK_MS.catalogEmbed,
      },
    ),
  ]
}
