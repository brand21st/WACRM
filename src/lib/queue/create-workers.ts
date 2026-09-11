import { Worker, type ConnectionOptions } from 'bullmq';

import { processAiChatReply } from '@/lib/queue/processors/ai-chat-reply';
import { processAiVoiceInbound } from '@/lib/queue/processors/ai-voice-inbound';
import { processCallRecordingJob } from '@/lib/queue/processors/call-recording';
import { processCatalogEmbed } from '@/lib/queue/processors/catalog-embed';
import { processCatalogMetaSync } from '@/lib/queue/processors/catalog-meta-sync';
import { processKnowledgeScrape } from '@/lib/queue/processors/knowledge-scrape';
import { processAiConversationFollowUp } from '@/lib/queue/processors/ai-conversation-follow-up';
import { processAiConversationAnalyze } from '@/lib/queue/processors/ai-conversation-analyze';
import { processAiSalesPatternDiscover } from '@/lib/queue/processors/ai-sales-pattern-discover';
import { processAiRecommendationIntelligence } from '@/lib/queue/processors/ai-recommendation-intelligence';
import { processAiSalesPatternEffectiveness } from '@/lib/queue/processors/ai-sales-pattern-effectiveness';
import { processAiBehaviorOptimization } from '@/lib/queue/processors/ai-behavior-optimization';
import {
  QUEUE_WORKER_GROUP,
  QUEUE_NAMES,
  WORKER_CONCURRENCY,
  WORKER_LOCK_MS,
  type QueueName,
  type WorkerGroup,
} from '@/lib/queue/names';

type WorkerDefinition = {
  name: QueueName;
  create: () => Worker;
};

function defineWorker<Data>(
  name: QueueName,
  processor: (data: Data) => Promise<unknown>,
  connection: ConnectionOptions,
  concurrency: number,
  lockDuration: number
): WorkerDefinition {
  return {
    name,
    create: () =>
      new Worker<Data>(
        name,
        async (job) => {
          await processor(job.data);
        },
        { connection, concurrency, lockDuration }
      ),
  };
}

export function createQueueWorkers(
  connection: ConnectionOptions,
  group: WorkerGroup = 'all'
): Worker[] {
  const definitions = [
    defineWorker(
      QUEUE_NAMES.aiChatReply,
      processAiChatReply,
      connection,
      WORKER_CONCURRENCY.aiChatReply,
      WORKER_LOCK_MS.aiChatReply
    ),
    defineWorker(
      QUEUE_NAMES.aiVoiceInbound,
      processAiVoiceInbound,
      connection,
      WORKER_CONCURRENCY.aiVoiceInbound,
      WORKER_LOCK_MS.aiVoiceInbound
    ),
    defineWorker(
      QUEUE_NAMES.callRecording,
      processCallRecordingJob,
      connection,
      WORKER_CONCURRENCY.callRecording,
      WORKER_LOCK_MS.callRecording
    ),
    defineWorker(
      QUEUE_NAMES.knowledgeScrape,
      processKnowledgeScrape,
      connection,
      WORKER_CONCURRENCY.knowledgeScrape,
      WORKER_LOCK_MS.knowledgeScrape
    ),
    defineWorker(
      QUEUE_NAMES.catalogMetaSync,
      processCatalogMetaSync,
      connection,
      WORKER_CONCURRENCY.catalogMetaSync,
      WORKER_LOCK_MS.catalogMetaSync
    ),
    defineWorker(
      QUEUE_NAMES.catalogEmbed,
      processCatalogEmbed,
      connection,
      WORKER_CONCURRENCY.catalogEmbed,
      WORKER_LOCK_MS.catalogEmbed
    ),
    defineWorker(
      QUEUE_NAMES.aiConversationFollowUp,
      processAiConversationFollowUp,
      connection,
      WORKER_CONCURRENCY.aiConversationFollowUp,
      WORKER_LOCK_MS.aiConversationFollowUp
    ),
    defineWorker(
      QUEUE_NAMES.aiConversationAnalyze,
      processAiConversationAnalyze,
      connection,
      WORKER_CONCURRENCY.aiConversationAnalyze,
      WORKER_LOCK_MS.aiConversationAnalyze
    ),
    defineWorker(
      QUEUE_NAMES.aiSalesPatternDiscover,
      processAiSalesPatternDiscover,
      connection,
      WORKER_CONCURRENCY.aiSalesPatternDiscover,
      WORKER_LOCK_MS.aiSalesPatternDiscover
    ),
    defineWorker(
      QUEUE_NAMES.aiRecommendationIntelligence,
      processAiRecommendationIntelligence,
      connection,
      WORKER_CONCURRENCY.aiRecommendationIntelligence,
      WORKER_LOCK_MS.aiRecommendationIntelligence
    ),
    defineWorker(
      QUEUE_NAMES.aiSalesPatternEffectiveness,
      processAiSalesPatternEffectiveness,
      connection,
      WORKER_CONCURRENCY.aiSalesPatternEffectiveness,
      WORKER_LOCK_MS.aiSalesPatternEffectiveness
    ),
    defineWorker(
      QUEUE_NAMES.aiBehaviorOptimization,
      processAiBehaviorOptimization,
      connection,
      WORKER_CONCURRENCY.aiBehaviorOptimization,
      WORKER_LOCK_MS.aiBehaviorOptimization
    ),
  ];

  return definitions
    .filter(({ name }) => group === 'all' || QUEUE_WORKER_GROUP[name] === group)
    .map(({ create }) => create());
}
