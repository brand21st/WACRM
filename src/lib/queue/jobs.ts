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
