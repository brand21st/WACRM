import { createClient } from '@supabase/supabase-js'

import { dispatchInboundFanout } from '@/lib/inbox/inbound-fanout'
import { resolveConversationByChannelUser } from '@/lib/meta/resolve-conversation'
import { getUserProfile } from '@/lib/meta/graph'
import { decrypt } from '@/lib/whatsapp/encryption'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { resolveAuditUserId } from '@/lib/api/v1/contacts'
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

interface MessagingEvent {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    is_deleted?: boolean
    attachments?: Array<{
      type?: string
      payload?: { url?: string }
    }>
    reply_to?: { mid?: string }
    quick_reply?: { payload?: string }
  }
  postback?: { payload?: string; title?: string }
  delivery?: { mids?: string[]; watermark?: number }
  read?: { watermark?: number }
  reaction?: { mid?: string; emoji?: string; action?: string }
  referral?: { ref?: string; source?: string; type?: string }
}

interface PageConnectionRow {
  account_id: string
  user_id: string | null
  page_id: string
  ig_user_id: string | null
  access_token: string
  messenger_status: string
  instagram_status: string
  mirror_inbound_media: boolean | null
}

export async function processMetaWebhookPayload(body: {
  object?: string
  entry?: Array<{
    id?: string
    messaging?: MessagingEvent[]
    standby?: MessagingEvent[]
  }>
}): Promise<void> {
  const object = body.object
  if (object !== 'page' && object !== 'instagram') {
    console.info('[meta/webhook] ignored object', object)
    return
  }
  const channel: Exclude<ChannelType, 'whatsapp'> =
    object === 'instagram' ? 'instagram' : 'messenger'

  for (const entry of body.entry ?? []) {
    const events = [...(entry.messaging ?? []), ...(entry.standby ?? [])]
    const connection = await findConnection(channel, entry.id)
    if (!connection) {
      console.info('[meta/webhook] no connection for entry', entry.id, channel)
      continue
    }
    if (
      (channel === 'instagram' && connection.instagram_status !== 'connected') ||
      (channel === 'messenger' && connection.messenger_status !== 'connected')
    ) {
      continue
    }
    let accessToken: string
    try {
      accessToken = decrypt(connection.access_token)
    } catch (err) {
      console.error('[meta/webhook] token decrypt failed', connection.account_id)
      continue
    }
    for (const event of events) {
      try {
        await processMessagingEvent({
          channel,
          connection,
          event,
          accessToken,
        })
      } catch (err) {
        console.error('[meta/webhook] event failed:', err)
      }
    }
  }
}

async function findConnection(
  channel: 'messenger' | 'instagram',
  entryId?: string,
): Promise<PageConnectionRow | null> {
  if (!entryId) return null
  const db = supabaseAdmin()
  if (channel === 'instagram') {
    const { data } = await db
      .from('meta_page_connections')
      .select(
        'account_id, user_id, page_id, ig_user_id, access_token, messenger_status, instagram_status, mirror_inbound_media',
      )
      .or(`ig_user_id.eq.${entryId},page_id.eq.${entryId}`)
      .maybeSingle()
    return data ?? null
  }
  const { data } = await db
    .from('meta_page_connections')
    .select(
      'account_id, user_id, page_id, ig_user_id, access_token, messenger_status, instagram_status, mirror_inbound_media',
    )
    .eq('page_id', entryId)
    .maybeSingle()
  return data ?? null
}

async function processMessagingEvent(args: {
  channel: Exclude<ChannelType, 'whatsapp'>
  connection: PageConnectionRow
  event: MessagingEvent
  accessToken: string
}): Promise<void> {
  const { channel, connection, event, accessToken } = args
  const accountId = connection.account_id

  if (event.delivery?.mids?.length) {
    await markStatuses(event.delivery.mids, 'delivered', accountId)
    return
  }
  if (event.read) {
    // Instagram messaging_seen also arrives as read
    return
  }
  if (event.reaction?.mid) {
    await handleReaction(event, accountId)
    return
  }

  const isEcho = Boolean(event.message?.is_echo)
  const mid = event.message?.mid
  const senderId = event.sender?.id
  if (!mid || !senderId) {
    if (event.postback?.payload && event.sender?.id) {
      await persistAndFanout({
        channel,
        connection,
        accessToken,
        scopedId: event.sender.id,
        mid: `postback:${event.timestamp ?? Date.now()}:${event.postback.payload}`,
        contentType: 'interactive',
        contentText: event.postback.title || event.postback.payload,
        interactiveReplyId: event.postback.payload,
        isEcho: false,
        mediaUrl: null,
        mediaType: null,
      })
    }
    return
  }

  if (event.message?.is_deleted) {
    await persistAndFanout({
      channel,
      connection,
      accessToken,
      scopedId: senderId,
      mid,
      contentType: 'text',
      contentText: 'This message was deleted.',
      interactiveReplyId: null,
      isEcho,
      mediaUrl: null,
      mediaType: null,
      skipFanout: true,
    })
    return
  }

  const attachment = event.message?.attachments?.[0]
  let contentType = 'text'
  let contentText = event.message?.text ?? null
  let mediaUrl: string | null = attachment?.payload?.url ?? null
  let mediaType: string | null = null
  if (attachment?.type === 'image') contentType = 'image'
  else if (attachment?.type === 'video') contentType = 'video'
  else if (attachment?.type === 'audio') contentType = 'audio'
  else if (attachment?.type === 'file') contentType = 'document'
  if (attachment && !contentText) {
    contentText = `[${attachment.type ?? 'attachment'}]`
  }
  if (event.referral?.ref) {
    contentText = contentText
      ? `${contentText}`
      : `Started from ${event.referral.source ?? 'referral'}`
  }

  const interactiveReplyId =
    event.message?.quick_reply?.payload ??
    event.postback?.payload ??
    null
  if (interactiveReplyId && !contentText) {
    contentText = event.postback?.title ?? interactiveReplyId
    contentType = 'interactive'
  }

  await persistAndFanout({
    channel,
    connection,
    accessToken,
    scopedId: isEcho ? (event.recipient?.id ?? senderId) : senderId,
    mid,
    contentType: interactiveReplyId ? 'interactive' : contentType,
    contentText,
    interactiveReplyId,
    isEcho,
    mediaUrl,
    mediaType,
    replyToMid: event.message?.reply_to?.mid ?? null,
  })
}

async function persistAndFanout(args: {
  channel: Exclude<ChannelType, 'whatsapp'>
  connection: PageConnectionRow
  accessToken: string
  scopedId: string
  mid: string
  contentType: string
  contentText: string | null
  interactiveReplyId: string | null
  isEcho: boolean
  mediaUrl: string | null
  mediaType: string | null
  replyToMid?: string | null
  skipFanout?: boolean
}): Promise<void> {
  const db = supabaseAdmin()
  const accountId = args.connection.account_id
  let ownerUserId = args.connection.user_id
  if (!ownerUserId) {
    try {
      ownerUserId = await resolveAuditUserId(db, accountId)
    } catch {
      console.error('[meta/webhook] no audit user for', accountId)
      return
    }
  }

  let name: string | null = null
  let avatarUrl: string | null = null
  if (!args.isEcho) {
    const profile = await getUserProfile({
      scopedId: args.scopedId,
      pageAccessToken: args.accessToken,
      platform: args.channel,
    })
    name = profile.name
    avatarUrl = profile.profilePic
  }

  const resolved = await resolveConversationByChannelUser({
    db,
    accountId,
    channel: args.channel,
    channelUserId: args.scopedId,
    name,
    avatarUrl,
  })

  let replyToInternalId: string | null = null
  if (args.replyToMid) {
    const { data } = await db
      .from('messages')
      .select('id')
      .eq('conversation_id', resolved.conversationId)
      .eq('message_id', args.replyToMid)
      .maybeSingle()
    replyToInternalId = data?.id ?? null
  }

  const { data: insertedRows, error: msgError } = await db
    .from('messages')
    .upsert(
      {
        conversation_id: resolved.conversationId,
        sender_type: args.isEcho ? 'agent' : 'customer',
        content_type: args.contentType,
        content_text: args.contentText,
        media_url: args.mediaUrl,
        media_type: args.mediaType,
        message_id: args.mid,
        status: args.isEcho ? 'sent' : 'delivered',
        reply_to_message_id: replyToInternalId,
        interactive_reply_id: args.interactiveReplyId,
      },
      { onConflict: 'conversation_id,message_id', ignoreDuplicates: true },
    )
    .select('id')

  if (msgError) {
    console.error('[meta/webhook] insert failed:', msgError)
    return
  }
  if (!insertedRows || insertedRows.length === 0) {
    console.info('[meta/webhook] duplicate ignored', args.mid)
    return
  }

  if (args.isEcho || args.skipFanout) {
    await db
      .from('conversations')
      .update({
        last_message_text: args.contentText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', resolved.conversationId)
    return
  }

  const { data: conversation } = await db
    .from('conversations')
    .select('id, assigned_agent_id, ai_autoreply_disabled, last_message_text, status')
    .eq('id', resolved.conversationId)
    .maybeSingle()
  const { data: contactRecord } = await db
    .from('contacts')
    .select('id, phone, name')
    .eq('id', resolved.contactId)
    .maybeSingle()
  if (!conversation || !contactRecord) return

  const { count } = await db
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', resolved.conversationId)
    .eq('sender_type', 'customer')
  const isFirstInboundMessage = (count ?? 0) <= 1

  await dispatchInboundFanout({
    accountId,
    configOwnerUserId: ownerUserId,
    conversation,
    contactRecord,
    contactOutcome: { wasCreated: resolved.contactCreated },
    persistedMessageId: String(insertedRows[0].id),
    metaMessageId: args.mid,
    contentType: args.contentType,
    contentText: args.contentText,
    mediaUrl: args.mediaUrl,
    mediaType: args.mediaType,
    interactiveReplyId: args.interactiveReplyId,
    isFirstInboundMessage,
    accessToken: args.accessToken,
    channel: args.channel,
    contactDisplayName: contactRecord.name,
    contactDisplayPhone: contactRecord.phone,
    inboundMediaId: null,
    imageMediaId: null,
    audioMediaId: null,
    mediaBuffer: null,
  })
}

async function markStatuses(
  mids: string[],
  status: string,
  accountId: string,
): Promise<void> {
  const db = supabaseAdmin()
  for (const mid of mids) {
    const { data } = await db
      .from('messages')
      .update({ status })
      .eq('message_id', mid)
      .select('id, conversation_id')
      .maybeSingle()
    if (data?.conversation_id) {
      await dispatchWebhookEvent(db, accountId, 'message.status_updated', {
        conversation_id: data.conversation_id,
        whatsapp_message_id: mid,
        message_id: mid,
        status,
      })
    }
  }
}

async function handleReaction(event: MessagingEvent, accountId: string) {
  const mid = event.reaction?.mid
  const emoji = event.reaction?.emoji
  if (!mid || !emoji || event.reaction?.action === 'unreact') return
  const db = supabaseAdmin()
  const { data: message } = await db
    .from('messages')
    .select('id, conversation_id')
    .eq('message_id', mid)
    .maybeSingle()
  if (!message) return
  await db.from('message_reactions').upsert(
    {
      message_id: message.id,
      conversation_id: message.conversation_id,
      actor_type: 'customer',
      actor_id: null,
      emoji,
    },
    { onConflict: 'message_id,actor_type,actor_id' },
  )
  void accountId
}
