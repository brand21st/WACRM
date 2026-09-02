import type { SupabaseClient } from '@supabase/supabase-js'
import { isUniqueViolation } from '@/lib/contacts/dedupe'

export type CallTurnDirection = 'in' | 'out'

export function callTurnMessageId(
  callId: string,
  direction: CallTurnDirection,
  seq: string,
): string {
  return `callturn:${callId}:${direction}:${seq}`
}

export function isCallTurnMessageId(messageId: string | null | undefined): boolean {
  return typeof messageId === 'string' && messageId.startsWith('callturn:')
}

/**
 * Persist a spoken call turn in the inbox without sending WhatsApp.
 * Unique `message_id` is idempotent under `(conversation_id, message_id)`.
 */
export async function persistCallTurnMessage(
  db: SupabaseClient,
  args: {
    conversationId: string
    direction: CallTurnDirection
    callId: string
    text: string
    seq?: string
  },
): Promise<{ messageId: string; inserted: boolean }> {
  const text = args.text.trim()
  const seq = args.seq ?? `${Date.now()}`
  const messageId = callTurnMessageId(args.callId, args.direction, seq)
  if (!text) return { messageId, inserted: false }

  const { error } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: args.direction === 'in' ? 'customer' : 'bot',
    content_type: 'text',
    content_text: text,
    message_id: messageId,
    status: 'sent',
    ai_generated: args.direction === 'out',
  })

  if (error) {
    if (isUniqueViolation(error)) return { messageId, inserted: false }
    throw error
  }

  await db
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { messageId, inserted: true }
}
