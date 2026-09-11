import { supabaseAdmin } from '@/lib/ai/admin-client'
import {
  analyzeConversation,
  markAnalysisFailed,
} from '@/lib/ai/intelligence/analyze-conversation'
import type { ConversationAnalyzeJob } from '@/lib/queue/jobs'

/**
 * Persist tenant-scoped sales events. Throws on unexpected DB failures
 * so BullMQ can retry. Never surfaces to WhatsApp.
 */
export async function processAiConversationAnalyze(
  job: ConversationAnalyzeJob,
): Promise<void> {
  const db = supabaseAdmin()
  try {
    await analyzeConversation(db, job)
  } catch (error) {
    await markAnalysisFailed(db, job, error)
    throw error
  }
}
