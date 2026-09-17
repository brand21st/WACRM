import type { SupabaseClient } from '@supabase/supabase-js'

import { cancelConversationFollowUp } from '@/lib/ai/follow-up'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { sessionWindowUrgency } from '@/lib/inbox/session-window'
import { resolveTransport } from '@/lib/meta/channel-transport'
import { sendPageMessage, sendPageSenderAction } from '@/lib/meta/graph'
import type { InteractiveButton, InteractiveListSection } from '@/lib/whatsapp/meta-api'
import { SendMessageError } from '@/lib/whatsapp/send-message'

export function assertPageMessagingWindow(expiresAt: string | null | undefined): void {
  if (!expiresAt) {
    throw new SendMessageError(
      'session_expired',
      'The customer needs to message you again before you can reply.',
      400,
    )
  }
  const urgency = sessionWindowUrgency(new Date(expiresAt).getTime() - Date.now())
  if (urgency === 'expired') {
    throw new SendMessageError(
      'session_expired',
      'The customer needs to message you again before you can reply.',
      400,
    )
  }
}

export function pageTextMessage(text: string): Record<string, unknown> {
  return { text }
}

export function pageMediaMessage(args: {
  kind: 'image' | 'video' | 'audio' | 'document'
  url: string
  caption?: string | null
}): Record<string, unknown> {
  const type =
    args.kind === 'document' ? 'file' : args.kind
  const payload: Record<string, unknown> = { url: args.url }
  if (args.caption && args.kind !== 'audio') payload.caption = args.caption
  return {
    attachment: { type, payload },
  }
}

export function pageButtonsMessage(args: {
  bodyText: string
  buttons: InteractiveButton[]
}): Record<string, unknown> {
  const buttons = args.buttons.slice(0, 3).map((b) => ({
    type: 'postback',
    title: b.title.slice(0, 20),
    payload: b.id,
  }))
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text: args.bodyText.slice(0, 640),
        buttons,
      },
    },
  }
}

export function pageListMessage(args: {
  bodyText: string
  sections: InteractiveListSection[]
}): Record<string, unknown> {
  const rows = args.sections.flatMap((section) =>
    section.rows.map((row) => ({
      type: 'postback',
      title: row.title.slice(0, 20),
      payload: row.id,
    })),
  )
  const primary = rows.slice(0, 3)
  const subtitle = args.sections
    .map((s) => s.title)
    .filter(Boolean)
    .join(' · ')
  const text = [args.bodyText, subtitle].filter(Boolean).join('\n').slice(0, 640)
  if (primary.length === 0) return { text }
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: primary,
      },
    },
  }
}

export function pageCtaUrlMessage(args: {
  bodyText: string
  displayText: string
  url: string
  headerText?: string
  headerImageUrl?: string
}): Record<string, unknown> {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: (args.headerText || args.bodyText).slice(0, 80),
            subtitle: args.bodyText.slice(0, 80),
            ...(args.headerImageUrl ? { image_url: args.headerImageUrl } : {}),
            buttons: [
              {
                type: 'web_url',
                url: args.url,
                title: args.displayText.slice(0, 20),
              },
            ],
          },
        ],
      },
    },
  }
}

export async function sendPageTextForContact(args: {
  accountId: string
  contactId: string
  text: string
  replyToMid?: string
}): Promise<string> {
  const db = supabaseAdmin()
  const transport = await resolveTransport(db, args.accountId, args.contactId)
  if (transport.channel === 'whatsapp') {
    throw new Error('sendPageTextForContact is for Instagram and Messenger only')
  }
  const r = await sendPageMessage({
    pageId: transport.pageId,
    pageAccessToken: transport.accessToken,
    recipientId: transport.recipientId,
    message: pageTextMessage(args.text),
    replyToMid: args.replyToMid,
  })
  return r.messageId
}

export async function sendMessageOnPageChannel(
  db: SupabaseClient,
  accountId: string,
  args: {
    conversationId: string
    messageType: 'text' | 'image' | 'video' | 'audio' | 'document'
    contentText?: string | null
    mediaUrl?: string | null
    replyToMessageId?: string | null
    replyToMid?: string | null
  },
): Promise<{ messageId: string; whatsappMessageId: string }> {
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', args.conversationId)
    .eq('account_id', accountId)
    .single()
  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404)
  }
  const contact = conversation.contact as { id: string } | null
  if (!contact?.id) {
    throw new SendMessageError('bad_request', 'Contact not found', 400)
  }
  assertPageMessagingWindow(
    (conversation as { customer_service_expires_at?: string | null })
      .customer_service_expires_at,
  )

  const transport = await resolveTransport(db, accountId, contact.id)
  if (transport.channel === 'whatsapp') {
    throw new SendMessageError(
      'bad_request',
      'This conversation is on WhatsApp. Use the WhatsApp send endpoint.',
      400,
    )
  }

  let message: Record<string, unknown>
  if (args.messageType === 'text') {
    if (!args.contentText?.trim()) {
      throw new SendMessageError('bad_request', 'content_text is required', 400)
    }
    message = pageTextMessage(args.contentText)
  } else {
    if (!args.mediaUrl) {
      throw new SendMessageError(
        'bad_request',
        `media_url is required for ${args.messageType} messages`,
        400,
      )
    }
    message = pageMediaMessage({
      kind: args.messageType,
      url: args.mediaUrl,
      caption: args.contentText,
    })
  }

  const sent = await sendPageMessage({
    pageId: transport.pageId,
    pageAccessToken: transport.accessToken,
    recipientId: transport.recipientId,
    message,
    replyToMid: args.replyToMid ?? undefined,
  })

  const persistedText = args.contentText ?? null
  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: args.conversationId,
      sender_type: 'agent',
      content_type: args.messageType,
      content_text: persistedText,
      media_url: args.mediaUrl ?? null,
      message_id: sent.messageId,
      status: 'sent',
      reply_to_message_id: args.replyToMessageId ?? null,
    })
    .select('id')
    .single()
  if (msgError || !messageRecord) {
    throw new SendMessageError(
      'db_error',
      `Message sent to Meta but failed to save to DB: ${msgError?.message ?? 'unknown'}`,
      500,
    )
  }

  await db
    .from('conversations')
    .update({
      last_message_text: persistedText || `[${args.messageType}]`,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  await cancelConversationFollowUp({
    db,
    accountId,
    conversationId: args.conversationId,
  }).catch((err) => {
    console.warn('[meta/send] follow-up cancel failed:', err)
  })

  try {
    await supabaseAdmin()
      .from('flow_runs')
      .update({
        status: 'paused_by_agent',
        ended_at: new Date().toISOString(),
        end_reason: 'agent_replied',
      })
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'active')
  } catch (err) {
    console.error('[flows] pause-on-agent-send threw:', err)
  }

  return { messageId: messageRecord.id, whatsappMessageId: sent.messageId }
}

export async function sendPageTypingForContact(args: {
  accountId: string
  contactId: string
}): Promise<void> {
  const db = supabaseAdmin()
  const transport = await resolveTransport(db, args.accountId, args.contactId)
  if (transport.channel === 'whatsapp') return
  await sendPageSenderAction({
    pageId: transport.pageId,
    pageAccessToken: transport.accessToken,
    recipientId: transport.recipientId,
    senderAction: 'typing_on',
  })
}
