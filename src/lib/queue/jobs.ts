import {
  analyzeJobIdempotencyKey,
  type ConversationAnalyzeJob,
} from '@/lib/ai/intelligence/contracts';
import { randomUUID } from 'node:crypto';
import type { InboundModality } from '@/lib/ai/voice';

export type { ConversationAnalyzeJob };
export { analyzeJobIdempotencyKey };

export interface AiChatReplyJob {
  accountId: string;
  conversationId: string;
  contactId: string;
  configOwnerUserId: string;
  messageId: string;
  inboundContentType: Exclude<InboundModality, 'audio'>;
  inboundMetaMessageId?: string;
  inboundMediaUrl?: string | null;
  inboundMediaId?: string | null;
  inboundAccessToken?: string | null;
  isFirstInbound?: boolean;
}

export function aiChatReplyJob(args: {
  accountId: string;
  conversationId: string;
  contactId: string;
  configOwnerUserId: string;
  messageId: string;
  inboundContentType: Exclude<InboundModality, 'audio'>;
  inboundMetaMessageId: string;
  isFirstInbound: boolean;
  inboundMediaUrl?: string | null;
  inboundMediaId?: string | null;
  inboundAccessToken?: string | null;
}): AiChatReplyJob {
  const job: AiChatReplyJob = {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    configOwnerUserId: args.configOwnerUserId,
    messageId: args.messageId,
    inboundContentType: args.inboundContentType,
    inboundMetaMessageId: args.inboundMetaMessageId,
    isFirstInbound: args.isFirstInbound,
  };
  if (args.inboundContentType === 'image') {
    job.inboundMediaUrl = args.inboundMediaUrl ?? null;
    job.inboundMediaId = args.inboundMediaId ?? null;
    job.inboundAccessToken = args.inboundAccessToken ?? null;
  }
  return job;
}

export interface AiVoiceInboundJob {
  accountId: string;
  conversationId: string;
  contactId: string;
  messageId: string;
  userId: string;
  metaMessageId: string;
  mediaId: string;
  mimeType?: string | null;
}

export interface CallRecordingJob {
  accountId: string;
  callId: string;
}

export interface KnowledgeScrapeJob {
  jobId: string;
  accountId: string;
}

export interface CatalogMetaSyncJob {
  accountId: string;
  outboxId: string;
}

export interface CatalogEmbedJob {
  accountId: string;
  productId: string;
}

export interface AiConversationFollowUpJob {
  accountId: string;
  conversationId: string;
  followUpId: string;
  triggeringMessageId: string;
}

export interface AiSalesPatternDiscoverJob {
  accountId: string;
  runId: string;
  idempotencyKey: string;
}

export function aiSalesPatternDiscoverJob(
  accountId: string
): AiSalesPatternDiscoverJob {
  const id = accountId.trim();
  return {
    accountId: id,
    runId: randomUUID(),
    idempotencyKey: `${id}:patterns`,
  };
}

export interface AiSalesPatternEffectivenessJob {
  accountId: string;
  runId: string;
  /** `${accountId}:effectiveness` */
  idempotencyKey: string;
}

export interface AiRecommendationIntelligenceJob {
  accountId: string;
  runId: string;
  idempotencyKey: string;
  rebuild?: boolean;
}

export function aiRecommendationIntelligenceJob(
  accountId: string,
  options: { rebuild?: boolean } = {}
): AiRecommendationIntelligenceJob {
  const id = accountId.trim();
  if (!id)
    throw new Error('aiRecommendationIntelligenceJob requires accountId');
  return {
    accountId: id,
    runId: randomUUID(),
    idempotencyKey: `${id}:recommendation-intelligence`,
    rebuild: options.rebuild === true,
  };
}

export function aiSalesPatternEffectivenessJob(
  accountId: string
): AiSalesPatternEffectivenessJob {
  const id = accountId.trim();
  return {
    accountId: id,
    runId: randomUUID(),
    idempotencyKey: `${id}:effectiveness`,
  };
}

export interface AiBehaviorOptimizationJob {
  accountId: string;
  runId: string;
  /** `${accountId}:ai-behavior-optimization` */
  idempotencyKey: string;
}

export function aiBehaviorOptimizationJob(
  accountId: string
): AiBehaviorOptimizationJob {
  const id = accountId.trim();
  return {
    accountId: id,
    runId: randomUUID(),
    idempotencyKey: `${id}:ai-behavior-optimization`,
  };
}

export function aiConversationAnalyzeJob(args: {
  accountId: string;
  conversationId: string;
  contactId: string | null;
  trigger:
    | { type: 'message'; messageId: string }
    | { type: 'commerce'; sourceId: string };
}): ConversationAnalyzeJob {
  const runId = randomUUID();
  return {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    trigger: args.trigger,
    runId,
    idempotencyKey: analyzeJobIdempotencyKey(args),
  };
}
