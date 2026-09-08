import { processConversationFollowUp } from '@/lib/ai/follow-up'
import type { AiConversationFollowUpJob } from '@/lib/queue/jobs'

export async function processAiConversationFollowUp(
  job: AiConversationFollowUpJob,
): Promise<void> {
  await processConversationFollowUp(job)
}
