import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/automations/admin-client'
import { ACCOUNTS_PER_CRON } from '@/lib/ai/intelligence/sales-pattern-types'
import { drainPatternDiscoveryJobs } from '@/lib/ai/intelligence/discover-patterns'
import { drainPatternEffectivenessJobs } from '@/lib/ai/intelligence/evaluate-pattern-effectiveness'
import { drainAiBehaviorOptimizationJobs } from '@/lib/ai/intelligence/evaluate-ai-behavior-experiments'
import { reconcilePendingConversationAnalysis } from '@/lib/ai/intelligence/enqueue-bounded-analyze'
import { drainRecommendationIntelligence } from '@/lib/catalog/intelligence/recommendation-aggregation'
import {
  enqueueAiConversationAnalyze,
  enqueueAiRecommendationIntelligence,
  enqueueAiSalesPatternDiscover,
  enqueueAiSalesPatternEffectiveness,
  enqueueAiBehaviorOptimization,
} from '@/lib/queue/enqueue'
import {
  aiSalesPatternDiscoverJob,
  aiRecommendationIntelligenceJob,
  aiSalesPatternEffectivenessJob,
  aiBehaviorOptimizationJob,
} from '@/lib/queue/jobs'

/**
 * Recompute tenant-scoped sales_patterns from sales_events.
 * Same `x-cron-secret` / `AUTOMATION_CRON_SECRET` as other crons.
 *
 * Redis down → run discovery inline (not on the customer path).
 */
export async function GET(request: Request) {
  const expected = process.env.AUTOMATION_CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 })
  }
  const supplied = request.headers.get('x-cron-secret') ?? ''
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (
    suppliedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(suppliedBuf, expectedBuf)
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const analysis = await reconcilePendingConversationAnalysis(supabaseAdmin(), {
      limit: 100,
      enqueue: enqueueAiConversationAnalyze,
    })
    const discovery = await drainPatternDiscoveryJobs(supabaseAdmin(), {
      limit: ACCOUNTS_PER_CRON,
      enqueue: async (job) =>
        enqueueAiSalesPatternDiscover(aiSalesPatternDiscoverJob(job.accountId)),
    })
    const recommendations = await drainRecommendationIntelligence(
      supabaseAdmin(),
      {
        limit: ACCOUNTS_PER_CRON,
        enqueue: async (accountId) =>
          enqueueAiRecommendationIntelligence(
            aiRecommendationIntelligenceJob(accountId),
          ),
      },
    )
    const effectiveness = await drainPatternEffectivenessJobs(supabaseAdmin(), {
      limit: ACCOUNTS_PER_CRON,
      enqueue: async (job) =>
        enqueueAiSalesPatternEffectiveness(
          aiSalesPatternEffectivenessJob(job.accountId),
        ),
    })
    const optimization = await drainAiBehaviorOptimizationJobs(supabaseAdmin(), {
      limit: ACCOUNTS_PER_CRON,
      enqueue: async (job) =>
        enqueueAiBehaviorOptimization(aiBehaviorOptimizationJob(job.accountId)),
    })
    return NextResponse.json({
      analysis,
      discovery,
      recommendations,
      effectiveness,
      optimization,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[ai/patterns/cron]', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
