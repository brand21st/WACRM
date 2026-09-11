import { supabaseAdmin } from '@/lib/ai/admin-client'
import { evaluateAccountAiBehaviorExperiments } from '@/lib/ai/intelligence/evaluate-ai-behavior-experiments'
import type { AiBehaviorOptimizationJob } from '@/lib/queue/jobs'

/**
 * Recompute tenant experiment metrics for one account.
 * Throws on unexpected DB failures so BullMQ can retry.
 */
export async function processAiBehaviorOptimization(
  job: AiBehaviorOptimizationJob,
): Promise<void> {
  await evaluateAccountAiBehaviorExperiments(supabaseAdmin(), job.accountId)
}
