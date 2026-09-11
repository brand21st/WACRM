import { Queue, type QueueOptions } from 'bullmq';
import { randomUUID } from 'node:crypto';

import type {
  AiChatReplyJob,
  AiConversationFollowUpJob,
  AiVoiceInboundJob,
  CallRecordingJob,
  CatalogEmbedJob,
  CatalogMetaSyncJob,
  AiSalesPatternDiscoverJob,
  AiRecommendationIntelligenceJob,
  AiSalesPatternEffectivenessJob,
  AiBehaviorOptimizationJob,
  ConversationAnalyzeJob,
  KnowledgeScrapeJob,
} from '@/lib/queue/jobs';
import {
  accountRunJobOptions,
  DEFAULT_JOB_OPTIONS,
  QUEUE_NAMES,
} from '@/lib/queue/names';
import { getBullmqConnection } from '@/lib/queue/redis';

type QueueMap = {
  aiChatReply: Queue;
  aiVoiceInbound: Queue;
  callRecording: Queue;
  knowledgeScrape: Queue;
  catalogMetaSync: Queue;
  catalogEmbed: Queue;
  aiConversationFollowUp: Queue;
  aiConversationAnalyze: Queue;
  aiSalesPatternDiscover: Queue;
  aiRecommendationIntelligence: Queue;
  aiSalesPatternEffectiveness: Queue;
  aiBehaviorOptimization: Queue;
};

let queues: QueueMap | null = null;

export function isDuplicateJobError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exists/i.test(msg);
}

function queueOptions(): QueueOptions | null {
  const connection = getBullmqConnection();
  if (!connection) return null;
  return {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  };
}

function getQueues(): QueueMap | null {
  if (queues) return queues;
  const opts = queueOptions();
  if (!opts) return null;
  queues = {
    aiChatReply: new Queue(QUEUE_NAMES.aiChatReply, opts),
    aiVoiceInbound: new Queue(QUEUE_NAMES.aiVoiceInbound, opts),
    callRecording: new Queue(QUEUE_NAMES.callRecording, opts),
    knowledgeScrape: new Queue(QUEUE_NAMES.knowledgeScrape, opts),
    catalogMetaSync: new Queue(QUEUE_NAMES.catalogMetaSync, opts),
    catalogEmbed: new Queue(QUEUE_NAMES.catalogEmbed, opts),
    aiConversationFollowUp: new Queue(QUEUE_NAMES.aiConversationFollowUp, opts),
    aiConversationAnalyze: new Queue(QUEUE_NAMES.aiConversationAnalyze, opts),
    aiSalesPatternDiscover: new Queue(QUEUE_NAMES.aiSalesPatternDiscover, opts),
    aiRecommendationIntelligence: new Queue(
      QUEUE_NAMES.aiRecommendationIntelligence,
      opts
    ),
    aiSalesPatternEffectiveness: new Queue(
      QUEUE_NAMES.aiSalesPatternEffectiveness,
      opts
    ),
    aiBehaviorOptimization: new Queue(QUEUE_NAMES.aiBehaviorOptimization, opts),
  };
  return queues;
}

/** Test-only: drop cached Queue instances. */
export function resetQueuesForTests(): void {
  queues = null;
}

async function addJob(
  queue: Queue | undefined,
  name: string,
  data: object,
  jobId: string,
  delayMs?: number
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.add(name, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId,
      ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
    });
    // Duplicate custom jobIds are ignored without throwing.
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error(
      `[queue] enqueue ${name} failed:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Enqueue a chat AI reply (text or image). Returns false when Redis is
 * unset or the add fails — callers fall back to inline dispatch.
 * A Meta webhook replay that hits the same messageId is success.
 */
export async function enqueueAiChatReply(
  data: AiChatReplyJob
): Promise<boolean> {
  return addJob(
    getQueues()?.aiChatReply,
    QUEUE_NAMES.aiChatReply,
    data,
    data.messageId
  );
}

/**
 * Enqueue inbound voice STT + spoken reply. Returns false when Redis
 * is unset or the add fails — callers fall back to Postgres jobs.
 */
export async function enqueueAiVoiceInbound(
  data: AiVoiceInboundJob
): Promise<boolean> {
  return addJob(
    getQueues()?.aiVoiceInbound,
    QUEUE_NAMES.aiVoiceInbound,
    data,
    data.messageId
  );
}

/**
 * Enqueue post-call STT + summary. Returns false when Redis is unset
 * or the add fails — callers fall back to in-process processing.
 */
export async function enqueueCallRecording(
  data: CallRecordingJob
): Promise<boolean> {
  return addJob(
    getQueues()?.callRecording,
    QUEUE_NAMES.callRecording,
    data,
    data.callId
  );
}

/** Enqueue remaining knowledge-scrape pages. Falls back to after(). */
export async function enqueueKnowledgeScrape(
  data: KnowledgeScrapeJob
): Promise<boolean> {
  return addJob(
    getQueues()?.knowledgeScrape,
    QUEUE_NAMES.knowledgeScrape,
    data,
    data.jobId
  );
}

/**
 * Enqueue one catalog outbox row for Meta Commerce sync.
 * jobId = outboxId so a replay is treated as already queued.
 */
export async function enqueueCatalogMetaSync(
  data: CatalogMetaSyncJob
): Promise<boolean> {
  return addJob(
    getQueues()?.catalogMetaSync,
    QUEUE_NAMES.catalogMetaSync,
    data,
    data.outboxId
  );
}

/** Enqueue one product embedding refresh. jobId = productId to debounce storms. */
export async function enqueueCatalogEmbed(
  data: CatalogEmbedJob
): Promise<boolean> {
  return addJob(
    getQueues()?.catalogEmbed,
    QUEUE_NAMES.catalogEmbed,
    data,
    data.productId
  );
}

export async function enqueueAiConversationFollowUp(
  data: AiConversationFollowUpJob,
  delayMs: number
): Promise<boolean> {
  return addJob(
    getQueues()?.aiConversationFollowUp,
    QUEUE_NAMES.aiConversationFollowUp,
    data,
    data.followUpId,
    delayMs
  );
}

/**
 * Background conversation analyzer. Redis unset → false; callers must
 * not inline-analyze on the customer path.
 */
export async function enqueueAiConversationAnalyze(
  data: ConversationAnalyzeJob,
  delayMs?: number
): Promise<boolean> {
  const queue = getQueues()?.aiConversationAnalyze;
  if (!queue) return false;
  try {
    await queue.add(QUEUE_NAMES.aiConversationAnalyze, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: data.runId,
      ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
      deduplication: {
        id: `${data.accountId}:${data.conversationId}`,
        ttl: 6_000,
        replace: true,
      },
    });
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error('[queue] enqueue conversation analyze failed:', err);
    return false;
  }
}

/**
 * Background tenant pattern discovery. Redis unset → false; cron
 * may run the aggregator inline (not on the customer path).
 */
export async function enqueueAiSalesPatternDiscover(
  data: AiSalesPatternDiscoverJob
): Promise<boolean> {
  const queue = getQueues()?.aiSalesPatternDiscover;
  if (!queue) return false;
  try {
    await queue.add(QUEUE_NAMES.aiSalesPatternDiscover, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...accountRunJobOptions(
        data.accountId,
        'patterns',
        data.runId || randomUUID()
      ),
      deduplication: { id: data.accountId, ttl: 30_000, replace: true },
    });
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error('[queue] enqueue pattern discovery failed:', err);
    return false;
  }
}

export async function enqueueAiRecommendationIntelligence(
  data: AiRecommendationIntelligenceJob
): Promise<boolean> {
  const queue = getQueues()?.aiRecommendationIntelligence;
  if (!queue) return false;
  try {
    await queue.add(QUEUE_NAMES.aiRecommendationIntelligence, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...accountRunJobOptions(
        data.accountId,
        'recommendation-intelligence',
        data.runId || randomUUID()
      ),
      deduplication: {
        id: `${data.accountId}:recommendation-intelligence`,
        ttl: 30_000,
        replace: true,
      },
    });
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error('[queue] enqueue recommendation intelligence failed:', err);
    return false;
  }
}

/**
 * Background pattern-effectiveness recompute. Redis unset → false;
 * cron may run the evaluator inline (not on the customer path).
 */
export async function enqueueAiSalesPatternEffectiveness(
  data: AiSalesPatternEffectivenessJob
): Promise<boolean> {
  const queue = getQueues()?.aiSalesPatternEffectiveness;
  if (!queue) return false;
  try {
    await queue.add(QUEUE_NAMES.aiSalesPatternEffectiveness, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...accountRunJobOptions(
        data.accountId,
        'effectiveness',
        data.runId || randomUUID()
      ),
    });
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error('[queue] enqueue pattern effectiveness failed:', err);
    return false;
  }
}

/**
 * Background behavior-experiment evaluation. Redis unset → false;
 * cron may run the evaluator inline (not on the customer path).
 */
export async function enqueueAiBehaviorOptimization(
  data: AiBehaviorOptimizationJob
): Promise<boolean> {
  const queue = getQueues()?.aiBehaviorOptimization;
  if (!queue) return false;
  try {
    await queue.add(QUEUE_NAMES.aiBehaviorOptimization, data, {
      ...DEFAULT_JOB_OPTIONS,
      ...accountRunJobOptions(
        data.accountId,
        'ai-behavior-optimization',
        data.runId || randomUUID()
      ),
    });
    return true;
  } catch (err) {
    if (isDuplicateJobError(err)) return true;
    console.error('[queue] enqueue behavior optimization failed:', err);
    return false;
  }
}

export async function removeAiConversationFollowUp(
  followUpId: string
): Promise<void> {
  const queue = getQueues()?.aiConversationFollowUp;
  if (!queue) return;
  try {
    await queue.remove(followUpId);
  } catch (err) {
    console.warn(
      '[queue] remove ai-conversation-follow-up failed:',
      err instanceof Error ? err.message : err
    );
  }
}
