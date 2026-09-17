import { createClient } from '@supabase/supabase-js'

import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { loadAiConfig } from '@/lib/ai/config'
import { describeInboundImage } from '@/lib/ai/describe-inbound-image'
import { cancelConversationFollowUp } from '@/lib/ai/follow-up'
import { markConversationLearningPending } from '@/lib/ai/intelligence/trigger-learning'
import { isLanguagePickerReply } from '@/lib/ai/language-picker'
import { sendPhotoWaitAck } from '@/lib/ai/photo-wait-ack'
import { transcribeInboundVoiceNote } from '@/lib/ai/transcribe-inbound'
import { INBOUND_VOICE_PLACEHOLDER } from '@/lib/ai/voice'
import { enqueueVoiceInboundJob } from '@/lib/ai/voice-inbound-jobs'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import {
  completeCommerceAddressFromForm,
  handleAddressConfirmationReply,
  handleDiscountCodeReply,
  handleInboundWhatsAppOrder,
  handleReceiptEmailReply,
  handleSavedAddressPickerReply,
} from '@/lib/commerce/checkout'
import { reopenClosedConversation } from '@/lib/conversations/reopen'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import { engineSendTypingIndicator } from '@/lib/flows/meta-send'
import { notifyAccountDevicesOfIncomingMessage } from '@/lib/notifications/expo-push'
import {
  enqueueAiChatReply,
  enqueueAiConversationAnalyze,
  enqueueAiVoiceInbound,
} from '@/lib/queue/enqueue'
import { aiChatReplyJob, aiConversationAnalyzeJob } from '@/lib/queue/jobs'
import { loadShopifyConfig } from '@/lib/shopify/config'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import type { ChannelType } from '@/types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _admin: any = null
function supabaseAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _admin
}

export interface InboundFanoutArgs {
  accountId: string
  configOwnerUserId: string
  conversation: {
    id: string
    assigned_agent_id?: string | null
    ai_autoreply_disabled?: boolean | null
    last_message_text?: string | null
    status?: string
  }
  contactRecord: { id: string; phone?: string | null; name?: string | null }
  contactOutcome: { wasCreated: boolean }
  persistedMessageId: string
  metaMessageId: string
  contentType: string
  contentText: string | null
  mediaUrl: string | null
  mediaType: string | null
  interactiveReplyId: string | null
  isFirstInboundMessage: boolean
  accessToken: string
  channel: ChannelType
  contactDisplayName?: string | null
  contactDisplayPhone?: string | null
  inboundMediaId?: string | null
  imageMediaId?: string | null
  audioMediaId?: string | null
  mediaBuffer?: Buffer | null
  whatsappOrderMessage?: Parameters<typeof handleInboundWhatsAppOrder>[0]['message']
  addressFormReply?: { name?: string; response_json?: string } | null
}

async function flagBroadcastReplyIfAny(accountId: string, contactId: string) {
  try {
    const { data: recs, error } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, status, broadcast_id, broadcasts!inner(account_id)')
      .eq('contact_id', contactId)
      .eq('broadcasts.account_id', accountId)
      .in('status', ['sent', 'delivered', 'read'])
      .order('created_at', { ascending: false })
      .limit(1)
    if (error || !recs || recs.length === 0) return
    await supabaseAdmin()
      .from('broadcast_recipients')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', recs[0].id)
  } catch (err) {
    console.error('flagBroadcastReplyIfAny failed:', err)
  }
}

export async function dispatchInboundFanout(args: InboundFanoutArgs): Promise<void> {
  const {
    accountId,
    configOwnerUserId,
    conversation,
    contactRecord,
    contactOutcome,
    persistedMessageId,
    metaMessageId,
    contentType,
    mediaUrl,
    mediaType,
    interactiveReplyId,
    isFirstInboundMessage,
    accessToken,
    channel,
  } = args
  let contentText = args.contentText

  if (contentType !== 'call') {
    void notifyAccountDevicesOfIncomingMessage({
      accountId,
      conversationId: conversation.id,
      contactName: contactRecord.name ?? args.contactDisplayName ?? null,
      contactPhone: contactRecord.phone ?? args.contactDisplayPhone ?? '',
      contentType,
      contentText,
    }).catch((err) => {
      console.warn('[fanout] expo push failed:', err)
    })
  }

  const shouldAnalyzeConversation =
    (contentType !== 'audio' &&
      contentType !== 'image' &&
      Boolean(contentText?.trim())) ||
    contentType === 'order' ||
    contentType === 'interactive' ||
    Boolean(interactiveReplyId)
  if (shouldAnalyzeConversation) {
    const trigger = { type: 'message' as const, messageId: persistedMessageId }
    void (async () => {
      await markConversationLearningPending(supabaseAdmin(), {
        accountId,
        conversationId: conversation.id,
        trigger,
      })
      await enqueueAiConversationAnalyze(
        aiConversationAnalyzeJob({
          accountId,
          conversationId: conversation.id,
          contactId: contactRecord.id,
          trigger,
        }),
      )
    })().catch((err) => {
      console.warn('[fanout] conversation analyze enqueue failed:', err)
    })
  }

  const { error: convError } = await supabaseAdmin().rpc(
    'bump_conversation_on_inbound',
    {
      p_conversation_id: conversation.id,
      p_last_message_text: contentText || `[${contentType}]`,
    },
  )
  if (convError) {
    console.error('Error updating conversation:', convError)
  }

  await reopenClosedConversation(supabaseAdmin(), conversation)
  await cancelConversationFollowUp({
    accountId,
    conversationId: conversation.id,
  }).catch((err) => {
    console.warn('[fanout] follow-up cancel failed:', err)
  })

  let commerceReplyHandled = false
  if (channel === 'whatsapp') {
    if (args.whatsappOrderMessage) {
      try {
        await handleInboundWhatsAppOrder({
          db: supabaseAdmin(),
          accountId,
          userId: configOwnerUserId,
          conversationId: conversation.id,
          contactId: contactRecord.id,
          contactPhone: contactRecord.phone ?? args.contactDisplayPhone ?? '',
          contactName: contactRecord.name ?? args.contactDisplayName ?? '',
          message: args.whatsappOrderMessage,
        })
      } catch (err) {
        console.error('[fanout] inbound cart checkout failed:', err)
      }
    }

    const addressFormReply =
      args.addressFormReply?.name === 'address_message' ? args.addressFormReply : null
    if (addressFormReply?.response_json) {
      commerceReplyHandled = await completeCommerceAddressFromForm({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        responseJson: addressFormReply.response_json,
      })
    }
    if (!commerceReplyHandled && interactiveReplyId) {
      commerceReplyHandled = await handleSavedAddressPickerReply({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        contactPhone: contactRecord.phone ?? args.contactDisplayPhone ?? '',
        replyId: interactiveReplyId,
      })
    }
    if (!commerceReplyHandled && interactiveReplyId) {
      commerceReplyHandled = await handleAddressConfirmationReply({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        contactPhone: contactRecord.phone ?? args.contactDisplayPhone ?? '',
        replyId: interactiveReplyId,
      })
    }
    if (!commerceReplyHandled && interactiveReplyId) {
      commerceReplyHandled = await handleReceiptEmailReply({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        contactPhone: contactRecord.phone ?? args.contactDisplayPhone ?? '',
        replyId: interactiveReplyId,
      })
    }
    if (!commerceReplyHandled && interactiveReplyId) {
      commerceReplyHandled = await handleDiscountCodeReply({
        db: supabaseAdmin(),
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        replyId: interactiveReplyId,
      })
    }
  }

  const aiConfig = await loadAiConfig(supabaseAdmin(), accountId).catch((err) => {
    console.error('[fanout] loadAiConfig failed:', err)
    return null
  })

  let queuedVoice = false
  if (contentType === 'audio' && args.audioMediaId && persistedMessageId) {
    const voicePayload = {
      accountId,
      conversationId: conversation.id,
      contactId: contactRecord.id,
      messageId: persistedMessageId,
      userId: configOwnerUserId,
      metaMessageId,
      mediaId: args.audioMediaId,
      mimeType: mediaType,
    }
    if (!aiConfig?.fullAgentEnabled) {
      queuedVoice = await enqueueAiVoiceInbound(voicePayload)
      if (!queuedVoice) {
        queuedVoice = await enqueueVoiceInboundJob({
          db: supabaseAdmin(),
          ...voicePayload,
        })
      }
    }
    if (!queuedVoice) {
      const transcript = await transcribeInboundVoiceNote({
        accountId,
        mediaId: args.audioMediaId,
        accessToken,
        mimeType: mediaType,
        contentText,
        contentType,
        audio: args.mediaBuffer ?? null,
      })
      if (transcript) {
        contentText = transcript
        await persistTranscript(persistedMessageId, conversation.id, transcript)
      } else {
        contentText = contentText?.trim() || INBOUND_VOICE_PLACEHOLDER
        await persistTranscript(persistedMessageId, conversation.id, contentText)
      }
    }
  }

  if (contentType === 'image' && aiConfig && persistedMessageId) {
    const humanOwns = Boolean(conversation.assigned_agent_id)
    const paused =
      Boolean(conversation.ai_autoreply_disabled) && !aiConfig.fullAgentEnabled
    if (aiConfig.autoReplyEnabled && !humanOwns && !paused) {
      const languageHint = [contentText, conversation.last_message_text]
        .filter((s): s is string => Boolean(s?.trim()))
        .join(' ')
      await sendPhotoWaitAck({
        accountId,
        userId: configOwnerUserId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        languageHint,
      }).catch((err) => console.error('[fanout] photo wait ack failed:', err))
      if (aiConfig.typingIndicatorEnabled) {
        await engineSendTypingIndicator({
          accountId,
          inboundMessageId: metaMessageId,
          contactId: contactRecord.id,
        }).catch((err) =>
          console.warn('[fanout] typing after photo wait ack failed:', err),
        )
      }
    }
  }

  if (channel === 'whatsapp') {
    await flagBroadcastReplyIfAny(accountId, contactRecord.id)
  }

  let flowConsumed = false
  if (
    contentType !== 'audio' &&
    !commerceReplyHandled &&
    !(aiConfig?.fullAgentEnabled && !interactiveReplyId)
  ) {
    const flowResult = await dispatchInboundToFlows({
      accountId,
      userId: configOwnerUserId,
      contactId: contactRecord.id,
      conversationId: conversation.id,
      message: interactiveReplyId
        ? {
            kind: 'interactive_reply',
            reply_id: interactiveReplyId,
            reply_title: contentText ?? '',
            meta_message_id: metaMessageId,
          }
        : {
            kind: 'text',
            text: contentText ?? '',
            meta_message_id: metaMessageId,
          },
      isFirstInboundMessage,
    })
    flowConsumed = flowResult.consumed
  }

  const inboundText = contentText ?? ''
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
    | 'interactive_reply'
  )[] = []
  if (
    !flowConsumed &&
    !commerceReplyHandled &&
    contentType !== 'audio' &&
    !aiConfig?.fullAgentEnabled
  ) {
    automationTriggers.push('new_message_received', 'keyword_match')
    if (interactiveReplyId) automationTriggers.push('interactive_reply')
  }
  if (contactOutcome.wasCreated) automationTriggers.unshift('new_contact_created')
  if (isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')
  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId,
      triggerType,
      contactId: contactRecord.id,
      context: {
        message_text: inboundText,
        conversation_id: conversation.id,
        interactive_reply_id: interactiveReplyId ?? undefined,
      },
    }).catch((err) => console.error('[automations] dispatch failed:', err))
  }

  const inboundModality =
    contentType === 'audio' ? 'audio' : contentType === 'image' ? 'image' : 'text'
  const shouldAiReply =
    contentType !== 'order' &&
    !commerceReplyHandled &&
    !queuedVoice &&
    aiConfig?.autoReplyEnabled &&
    (inboundText.trim() || contentType === 'image' || contentType === 'audio') &&
    (!interactiveReplyId ||
      aiConfig.fullAgentEnabled ||
      isLanguagePickerReply(interactiveReplyId)) &&
    (!flowConsumed || aiConfig.fullAgentEnabled || contentType === 'audio')

  if (shouldAiReply && persistedMessageId) {
    if (inboundModality === 'text' || inboundModality === 'image') {
      const inboundContentType = inboundModality === 'image' ? 'image' : 'text'
      const chatJob = aiChatReplyJob({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
        messageId: persistedMessageId,
        inboundContentType,
        inboundMetaMessageId: metaMessageId,
        isFirstInbound: isFirstInboundMessage,
        inboundMediaUrl: mediaUrl,
        inboundMediaId: args.imageMediaId ?? args.inboundMediaId ?? null,
        inboundAccessToken: accessToken,
      })
      const queuedChat = aiConfig.fullAgentEnabled
        ? false
        : await enqueueAiChatReply(chatJob)
      if (!queuedChat) {
        if (contentType === 'image' && aiConfig) {
          const shopifyConfig = await loadShopifyConfig(
            supabaseAdmin(),
            accountId,
          ).catch(() => null)
          const description = await describeInboundImage({
            provider: aiConfig.provider,
            apiKey: aiConfig.apiKey,
            mediaUrl,
            caption: contentText,
            purpose: shopifyConfig ? 'shopping' : 'support',
            mediaId: args.imageMediaId ?? null,
            accessToken,
          })
          const nextText =
            description || contentText?.trim() || '[Customer sent a product photo]'
          if (nextText !== contentText) {
            contentText = nextText
            await persistTranscript(persistedMessageId, conversation.id, nextText)
          }
        }
        await dispatchInboundToAiReply({
          accountId,
          conversationId: conversation.id,
          contactId: contactRecord.id,
          configOwnerUserId,
          inboundContentType,
          inboundMetaMessageId: metaMessageId,
          inboundMediaUrl: inboundContentType === 'image' ? mediaUrl : null,
          inboundMediaId:
            inboundContentType === 'image' ? (args.imageMediaId ?? null) : null,
          inboundAccessToken: inboundContentType === 'image' ? accessToken : null,
          isFirstInbound: isFirstInboundMessage,
        })
      }
    } else if (inboundModality === 'audio') {
      await dispatchInboundToAiReply({
        accountId,
        conversationId: conversation.id,
        contactId: contactRecord.id,
        configOwnerUserId,
        inboundContentType: 'audio',
        inboundMetaMessageId: metaMessageId,
        isFirstInbound: isFirstInboundMessage,
      })
    }
  }

  await dispatchWebhookEvent(supabaseAdmin(), accountId, 'message.received', {
    conversation_id: conversation.id,
    contact_id: contactRecord.id,
    whatsapp_message_id: metaMessageId,
    message_id: metaMessageId,
    channel,
    content_type: contentType,
    text: contentText,
  })
}

async function persistTranscript(
  messageId: string,
  conversationId: string,
  text: string,
) {
  const { error } = await supabaseAdmin()
    .from('messages')
    .update({ content_text: text })
    .eq('id', messageId)
  if (error) {
    console.error('[fanout] failed to persist transcript:', error)
    return
  }
  await supabaseAdmin()
    .from('conversations')
    .update({ last_message_text: text })
    .eq('id', conversationId)
}
