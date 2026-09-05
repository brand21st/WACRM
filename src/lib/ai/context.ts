import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import { formatButtonTapForModel } from './chat-buttons'
import { isPhotoWaitAck } from './photo-wait-ack'
import { formatProductFocusNote } from '@/lib/shopify/product-focus'

interface DbMessage {
  sender_type: 'customer' | 'agent' | 'bot'
  content_text: string | null
  content_type?: string
  interactive_reply_id?: string | null
}

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
 */
export async function buildConversationContext(
  db: SupabaseClient,
  conversationId: string,
  limit: number = aiContextMessageLimit(),
  productFocus?: { handle: string; title?: string | null } | null,
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
  const messages: ChatMessage[] = rows
    .filter((m) => m.content_text && m.content_text.trim())
    .filter((m) => !isPhotoWaitAck(m.content_text))
    .map(toChatMessage)
  if (productFocus?.handle) {
    messages.unshift({
      role: 'assistant',
      content: formatProductFocusNote(productFocus),
    })
  }
  return messages
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
