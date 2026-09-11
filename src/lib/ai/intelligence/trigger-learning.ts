import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationAnalyzeJob } from './contracts'

/**
 * Durable, fail-open trigger marker. Queueing remains separate so callers can
 * preserve their existing customer-path behavior when Redis is unavailable.
 */
export async function markConversationLearningPending(
  db: SupabaseClient,
  args: {
    accountId: string
    conversationId: string
    trigger: ConversationAnalyzeJob['trigger']
  },
): Promise<boolean> {
  try {
    const { error } = await db.rpc('mark_conversation_analysis_trigger_pending', {
      p_account_id: args.accountId,
      p_conversation_id: args.conversationId,
      p_trigger: args.trigger,
    })
    if (error) {
      console.warn('[conversation-intelligence] pending marker failed:', error.message)
      return false
    }
    return true
  } catch (error) {
    console.warn('[conversation-intelligence] pending marker threw:', error)
    return false
  }
}
