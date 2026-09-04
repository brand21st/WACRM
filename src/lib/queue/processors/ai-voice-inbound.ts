import { supabaseAdmin } from '@/lib/ai/admin-client'
import { executeVoiceInboundWork } from '@/lib/ai/voice-inbound-jobs'
import type { AiVoiceInboundJob } from '@/lib/queue/jobs'

/**
 * STT + spoken auto-reply. Throws when transcription cannot complete
 * so BullMQ retries (Meta's media CDN is often briefly empty).
 */
export async function processAiVoiceInbound(
  job: AiVoiceInboundJob,
): Promise<void> {
  await executeVoiceInboundWork(supabaseAdmin(), {
    account_id: job.accountId,
    conversation_id: job.conversationId,
    contact_id: job.contactId,
    message_id: job.messageId,
    user_id: job.userId,
    meta_message_id: job.metaMessageId,
    media_id: job.mediaId,
    mime_type: job.mimeType ?? null,
  })
}
