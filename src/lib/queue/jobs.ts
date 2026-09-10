import {
  analyzeJobIdempotencyKey,
  type ConversationAnalyzeJob,
} from '@/lib/ai/intelligence/contracts'
import type { InboundModality } from '@/lib/ai/voice'

export type { ConversationAnalyzeJob }
export { analyzeJobIdempotencyKey }

export interface AiChatReplyJob {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  messageId: string
  inboundContentType: Exclude<InboundModality, 'audio'>
  inboundMetaMessageId?: string
  inboundMediaUrl?: string | null
  inboundMediaId?: string | null
  inboundAccessToken?: string | null
  isFirstInbound?: boolean
}

export function aiChatReplyJob(args: {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  messageId: string
  inboundContentType: Exclude<InboundModality, 'audio'>
  inboundMetaMessageId: string
  isFirstInbound: boolean
  inboundMediaUrl?: string | null
  inboundMediaId?: string | null
  inboundAccessToken?: string | null
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
  }
  if (args.inboundContentType === 'image') {
    job.inboundMediaUrl = args.inboundMediaUrl ?? null
    job.inboundMediaId = args.inboundMediaId ?? null
    job.inboundAccessToken = args.inboundAccessToken ?? null
  }
  return job
}

export interface AiVoiceInboundJob {
  accountId: string
  conversationId: string
  contactId: string
  messageId: string
  userId: string
  metaMessageId: string
  mediaId: string
  mimeType?: string | null
}

export interface CallRecordingJob {
  accountId: string
  callId: string
}

export interface KnowledgeScrapeJob {
  jobId: string
  accountId: string
}

export interface CatalogMetaSyncJob {
  accountId: string
  outboxId: string
}

export interface CatalogEmbedJob {
  accountId: string
  productId: string
}

export interface AiConversationFollowUpJob {
  accountId: string
  conversationId: string
  followUpId: string
  triggeringMessageId: string
}

export interface AiSalesPatternDiscoverJob {
  accountId: string
  /** `${accountId}:patterns` */
  idempotencyKey: string
}

export function aiSalesPatternDiscoverJob(accountId: string): AiSalesPatternDiscoverJob {
  const id = accountId.trim()
  return {
    accountId: id,
    idempotencyKey: `${id}:patterns`,
  }
}

export interface AiSalesPatternEffectivenessJob {
  accountId: string
  /** `${accountId}:effectiveness` */
  idempotencyKey: string
}

export function aiSalesPatternEffectivenessJob(
  accountId: string,
): AiSalesPatternEffectivenessJob {
  const id = accountId.trim()
  return {
    accountId: id,
    idempotencyKey: `${id}:effectiveness`,
  }
}

export function aiConversationAnalyzeJob(args: {
  accountId: string
  conversationId: string
  contactId: string
  triggeringMessageId: string
}): ConversationAnalyzeJob {
  return {
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    triggeringMessageId: args.triggeringMessageId,
    idempotencyKey: analyzeJobIdempotencyKey(args),
  }
}
