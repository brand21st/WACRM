import type { DefaultJobOptions, JobsOptions } from 'bullmq';

export const QUEUE_NAMES = {
  aiChatReply: 'ai-chat-reply',
  aiVoiceInbound: 'ai-voice-inbound',
  callRecording: 'call-recording',
  knowledgeScrape: 'knowledge-scrape',
  catalogMetaSync: 'catalog-meta-sync',
  catalogEmbed: 'catalog-embed',
  aiConversationFollowUp: 'ai-conversation-follow-up',
  aiConversationAnalyze: 'ai-conversation-analyze',
  aiSalesPatternDiscover: 'ai-sales-pattern-discover',
  aiRecommendationIntelligence: 'ai-recommendation-intelligence',
  aiSalesPatternEffectiveness: 'ai-sales-pattern-effectiveness',
  aiBehaviorOptimization: 'ai-behavior-optimization',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const COMPLETED_JOB_RETENTION_SECONDS = 60 * 60;
export const FAILED_JOB_RETENTION_SECONDS = 14 * 24 * 60 * 60;

export const DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  // Completed jobs only need a short diagnostic window. Removing them also
  // releases custom job IDs so fixed account-scoped jobs can run again.
  removeOnComplete: {
    age: COMPLETED_JOB_RETENTION_SECONDS,
    count: 1000,
  },
  // Keep enough failures for incident review without allowing Redis to grow
  // forever. BullMQ applies both limits, whichever is reached first.
  removeOnFail: {
    age: FAILED_JOB_RETENTION_SECONDS,
    count: 5000,
  },
};

export const WORKER_GROUPS = ['all', 'customer', 'learning'] as const;
export type WorkerGroup = (typeof WORKER_GROUPS)[number];

export const QUEUE_WORKER_GROUP: Record<
  QueueName,
  Exclude<WorkerGroup, 'all'>
> = {
  [QUEUE_NAMES.aiChatReply]: 'customer',
  [QUEUE_NAMES.aiVoiceInbound]: 'customer',
  [QUEUE_NAMES.callRecording]: 'customer',
  [QUEUE_NAMES.knowledgeScrape]: 'customer',
  [QUEUE_NAMES.catalogMetaSync]: 'customer',
  [QUEUE_NAMES.catalogEmbed]: 'customer',
  [QUEUE_NAMES.aiConversationFollowUp]: 'customer',
  [QUEUE_NAMES.aiConversationAnalyze]: 'learning',
  [QUEUE_NAMES.aiSalesPatternDiscover]: 'learning',
  [QUEUE_NAMES.aiRecommendationIntelligence]: 'learning',
  [QUEUE_NAMES.aiSalesPatternEffectiveness]: 'learning',
  [QUEUE_NAMES.aiBehaviorOptimization]: 'learning',
};

export function parseWorkerGroup(value: string | undefined): WorkerGroup {
  const normalized = value?.trim().toLowerCase();
  return WORKER_GROUPS.includes(normalized as WorkerGroup)
    ? (normalized as WorkerGroup)
    : 'all';
}

/**
 * Lifecycle options for recurring account-scoped jobs.
 *
 * Each scheduler invocation gets a unique job ID for auditability and retries,
 * while BullMQ simple-mode deduplication allows only one unfinished run for
 * the account/operation. The deduplication key is released when the run
 * completes or fails, so retained failures do not block the next run.
 */
export function accountRunJobOptions(
  accountId: string,
  operation: string,
  runId: string
): Pick<JobsOptions, 'jobId' | 'deduplication'> {
  const parts = [accountId, operation, runId].map((part) => {
    const normalized = part.trim();
    if (!normalized) throw new Error('Account run job IDs cannot be empty');
    return encodeURIComponent(normalized);
  });
  return {
    jobId: parts.join('--'),
    deduplication: { id: `${parts[0]}--${parts[1]}` },
  };
}

export const WORKER_CONCURRENCY = {
  aiChatReply: 8,
  aiVoiceInbound: 4,
  callRecording: 2,
  knowledgeScrape: 2,
  catalogMetaSync: 2,
  catalogEmbed: 2,
  aiConversationFollowUp: 4,
  aiConversationAnalyze: 2,
  aiSalesPatternDiscover: 2,
  aiRecommendationIntelligence: 2,
  aiSalesPatternEffectiveness: 2,
  aiBehaviorOptimization: 2,
} as const;

export const WORKER_LOCK_MS = {
  aiChatReply: 120_000,
  aiVoiceInbound: 180_000,
  callRecording: 180_000,
  knowledgeScrape: 300_000,
  catalogMetaSync: 120_000,
  catalogEmbed: 180_000,
  aiConversationFollowUp: 120_000,
  aiConversationAnalyze: 120_000,
  aiSalesPatternDiscover: 180_000,
  aiRecommendationIntelligence: 180_000,
  aiSalesPatternEffectiveness: 180_000,
  aiBehaviorOptimization: 180_000,
} as const;
