import { supabaseAdmin } from '@/lib/ai/admin-client'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { loadAiConfig } from '@/lib/ai/config'
import {
  describeInboundImage,
  IMAGE_PLACEHOLDER,
  PRODUCT_PHOTO_PLACEHOLDER,
} from '@/lib/ai/describe-inbound-image'
import { loadShopifyConfig } from '@/lib/shopify/config'
import type { AiChatReplyJob } from '@/lib/queue/jobs'

/**
 * Image vision (when needed) then the existing auto-reply path.
 * Throws on unexpected failures so BullMQ can retry.
 */
export async function processAiChatReply(job: AiChatReplyJob): Promise<void> {
  const db = supabaseAdmin()

  if (job.inboundContentType === 'image') {
    const config = await loadAiConfig(db, job.accountId).catch((err) => {
      console.error('[ai-chat-reply] loadAiConfig failed:', err)
      return null
    })
    if (config) {
      const { data: message } = await db
        .from('messages')
        .select('id, content_text')
        .eq('id', job.messageId)
        .maybeSingle()
      const caption =
        typeof message?.content_text === 'string' ? message.content_text : null
      const shopify = await loadShopifyConfig(db, job.accountId).catch(
        () => null,
      )
      const description = await describeInboundImage({
        provider: config.provider,
        apiKey: config.apiKey,
        mediaUrl: job.inboundMediaUrl ?? null,
        caption,
        purpose: shopify ? 'shopping' : 'support',
        mediaId: job.inboundMediaId ?? null,
        accessToken: job.inboundAccessToken ?? null,
      })
      const nextText =
        description ||
        caption?.trim() ||
        (shopify ? PRODUCT_PHOTO_PLACEHOLDER : IMAGE_PLACEHOLDER)
      if (nextText !== caption) {
        const { error } = await db
          .from('messages')
          .update({ content_text: nextText })
          .eq('id', job.messageId)
        if (error) {
          console.error('[ai-chat-reply] persist image description failed:', error.message)
        } else {
          await db
            .from('conversations')
            .update({ last_message_text: nextText })
            .eq('id', job.conversationId)
        }
      }
    }
  }

  await dispatchInboundToAiReply({
    accountId: job.accountId,
    conversationId: job.conversationId,
    contactId: job.contactId,
    configOwnerUserId: job.configOwnerUserId,
    inboundContentType: job.inboundContentType,
    inboundMetaMessageId: job.inboundMetaMessageId,
    inboundMediaUrl: job.inboundMediaUrl,
    inboundMediaId: job.inboundMediaId,
    inboundAccessToken: job.inboundAccessToken,
    isFirstInbound: job.isFirstInbound,
  })
}
