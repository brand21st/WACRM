import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { formatButtonTapForModel } from './chat-buttons'
import { isPhotoWaitAck } from './photo-wait-ack'
import {
  formatProductFocusNote,
  scopeMessagesToProductFocus,
} from '@/lib/shopify/product-focus'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type?: string
  interactive_reply_id?: string | null
}

export interface QuotedParent {
  id: string
  sender_type?: 'customer' | 'agent' | 'bot' | string | null
  content_type?: string | null
  content_text?: string | null
  interactive_payload?: InteractiveMessagePayload | null
}

export const SWIPE_REPLY_NOTE_PREFIX =
  'PRIMARY CONTEXT (customer swipe-replied to this message):'

/**
 * Fetch the last N messages of a conversation that carry text the model
 * can read, and map them to the provider-neutral chat shape. Customer
 * messages become `user`; agent and bot messages become `assistant`.
 *
 * Plain-text rows always qualify. Audio rows qualify when they have a
 * transcript in `content_text`. Image rows qualify when full-agent vision
 * or a caption filled `content_text`. Interactive rows (product cards,
 * cart / checkout CTAs, reply buttons) qualify via their body text so
 * the model can recap last-shown items. Other media without usable text
 * are excluded.
 *
 * Ordered oldest-first (chronological) so the transcript reads
 * naturally and the most recent customer message lands last.
 *
 * When `quotedParent` is set (a WhatsApp swipe-reply), that message is
 * injected as primary context even if it fell out of the last-N window.
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
  productFocus?: { handle: string; title?: string | null } | null,
  quotedParent?: QuotedParent | null,
): Promise<ChatMessage[]> {
  const { data, error } = await db
    .from('messages')
    .select('sender_type, content_text, content_type, interactive_reply_id')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'audio', 'image', 'interactive'])
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const mapped: ChatMessage[] = rows
    .filter((m) => m.content_text && m.content_text.trim())
    .filter((m) => !isPhotoWaitAck(m.content_text))
    .map(toChatMessage)
  const messages = productFocus?.handle
    ? scopeMessagesToProductFocus(mapped, productFocus)
    : mapped
  if (productFocus?.handle) {
    messages.unshift({
      role: 'assistant',
      content: formatProductFocusNote(productFocus),
    })
  }
  return applySwipeReplyContext(messages, quotedParent)
}

function toChatMessage(m: DbMessage): ChatMessage {
  const text = m.content_text!.trim()
  if (m.sender_type === 'customer') {
    return {
      role: 'user',
      content: formatButtonTapForModel(text, m.interactive_reply_id),
    }
  }
  return { role: 'assistant', content: text }
}

/** Load the message the customer swipe-replied to, scoped to this thread. */
export async function loadQuotedParent(
  db: SupabaseClient,
  conversationId: string,
  replyToMessageId: string,
): Promise<QuotedParent | null> {
  const id = replyToMessageId.trim()
  if (!id) return null
  const { data, error } = await db
    .from('messages')
    .select('id, sender_type, content_type, content_text, interactive_payload')
    .eq('id', id)
    .eq('conversation_id', conversationId)
    .maybeSingle()
  if (error) {
    console.warn('[ai context] loadQuotedParent failed:', error.message)
    return null
  }
  if (!data?.id) return null
  return data as QuotedParent
}

/**
 * Resolve the inbound row (by Meta wamid, else latest customer message)
 * and load its swipe-reply parent when `reply_to_message_id` is set.
 */
export async function resolveInboundSwipeReply(
  db: SupabaseClient,
  conversationId: string,
  inboundMetaMessageId?: string | null,
): Promise<{ inboundId: string | null; quotedParent: QuotedParent | null }> {
  let inbound: { id: string; reply_to_message_id: string | null } | null = null

  const metaId = inboundMetaMessageId?.trim()
  if (metaId) {
    const { data, error } = await db
      .from('messages')
      .select('id, reply_to_message_id')
      .eq('message_id', metaId)
      .eq('conversation_id', conversationId)
      .maybeSingle()
    if (error) {
      console.warn('[ai context] inbound swipe-reply lookup failed:', error.message)
    } else {
      inbound = data
    }
  }

  if (!inbound) {
    const { data, error } = await db
      .from('messages')
      .select('id, reply_to_message_id')
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.warn('[ai context] latest inbound swipe-reply lookup failed:', error.message)
    } else {
      inbound = data
    }
  }

  if (!inbound?.id) return { inboundId: null, quotedParent: null }
  if (!inbound.reply_to_message_id) {
    return { inboundId: inbound.id, quotedParent: null }
  }
  const quotedParent = await loadQuotedParent(
    db,
    conversationId,
    inbound.reply_to_message_id,
  )
  return { inboundId: inbound.id, quotedParent }
}

export function quotedParentBody(parent: QuotedParent | null | undefined): string {
  if (!parent) return ''
  const payload = parent.interactive_payload
  const payloadBody =
    payload && typeof payload === 'object' && 'body' in payload && typeof payload.body === 'string'
      ? payload.body.trim()
      : ''
  const text = parent.content_text?.trim() ?? ''
  return payloadBody || text
}

export function formatSwipeReplyNote(
  parent: QuotedParent | null | undefined,
): string {
  const body = quotedParentBody(parent)
  if (!body) return ''
  return `${SWIPE_REPLY_NOTE_PREFIX}\n${body}`
}

function swipeReplyPreview(body: string): string {
  const oneLine = body.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 80) return oneLine
  return `${oneLine.slice(0, 77)}...`
}

/**
 * Inject the swipe-replied parent as primary context. Chronological
 * history stays as background; the quoted message is called out even
 * when it is not in the last-N window.
 */
export function applySwipeReplyContext(
  messages: ChatMessage[],
  parent: QuotedParent | null | undefined,
): ChatMessage[] {
  const note = formatSwipeReplyNote(parent)
  if (!note) return messages

  const body = quotedParentBody(parent)
  const preview = swipeReplyPreview(body)
  const next = messages.map((m) => ({ ...m }))
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i].role === 'user') {
      next[i] = {
        ...next[i],
        content: `[Replying to: "${preview}"]\n${next[i].content}`,
      }
      break
    }
  }
  next.unshift({ role: 'assistant', content: note })
  return next
}
