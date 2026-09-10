import { supabaseAdmin } from '@/lib/ai/admin-client'
import { discoverAccountPatterns } from '@/lib/ai/intelligence/discover-patterns'
import type { AiSalesPatternDiscoverJob } from '@/lib/queue/jobs'

/**
 * Recompute tenant-scoped sales_patterns from sales_events.
 * Throws on unexpected DB failures so BullMQ can retry.
 */
export async function processAiSalesPatternDiscover(
  job: AiSalesPatternDiscoverJob,
): Promise<void> {
  await discoverAccountPatterns(supabaseAdmin(), job.accountId)
}
