import type { InboundModality } from '@/lib/ai/voice'

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
