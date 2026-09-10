import { supabaseAdmin } from '@/lib/ai/admin-client'
import { analyzeConversation } from '@/lib/ai/intelligence/analyze-conversation'
import type { ConversationAnalyzeJob } from '@/lib/queue/jobs'

/**
 * Persist tenant-scoped sales events. Throws on unexpected DB failures
 * so BullMQ can retry. Never surfaces to WhatsApp.
 */
export async function processAiConversationAnalyze(
  job: ConversationAnalyzeJob,
): Promise<void> {
  await analyzeConversation(supabaseAdmin(), job)
}
