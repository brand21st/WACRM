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
  const db = supabaseAdmin()
  const { data: startingCursor } = await db
    .from('pattern_discovery_cursors')
    .select('attempt_count')
    .eq('account_id', job.accountId)
    .maybeSingle()
  const startingAttempts = Number(startingCursor?.attempt_count ?? 0) + 1
  await db
    .from('pattern_discovery_cursors')
    .update({
      status: 'running',
      attempt_count: startingAttempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', job.accountId)
  try {
    await discoverAccountPatterns(db, job.accountId)
  } catch (error) {
    const now = new Date()
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
    const attempts = startingAttempts
    await db
      .from('pattern_discovery_cursors')
      .update({
        status: 'failed',
        last_error: message,
        attempt_count: attempts,
        next_attempt_at: new Date(
          now.getTime() + Math.min(60, 2 ** Math.min(attempts, 6)) * 60_000,
        ).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('account_id', job.accountId)
    throw error
  }
}
