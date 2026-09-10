import { supabaseAdmin } from '@/lib/ai/admin-client'
import { evaluateAccountPatternEffectiveness } from '@/lib/ai/intelligence/evaluate-pattern-effectiveness'
import type { AiSalesPatternEffectivenessJob } from '@/lib/queue/jobs'

/**
 * Recompute observational pattern effectiveness for one account.
 * Throws on unexpected DB failures so BullMQ can retry.
 */
export async function processAiSalesPatternEffectiveness(
  job: AiSalesPatternEffectivenessJob,
): Promise<void> {
  await evaluateAccountPatternEffectiveness(supabaseAdmin(), job.accountId)
}
