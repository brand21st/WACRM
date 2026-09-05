import { after, NextResponse } from 'next/server'

import {
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import {
  continueKnowledgeScrapeJob,
  createScrapeJob,
  findRunningScrapeJob,
  markScrapeJobFailed,
  publicScrapeJob,
  scrapeStartPage,
  startUrlAndMode,
} from '@/lib/ai/scrape-job'
import { enqueueKnowledgeScrape } from '@/lib/queue/enqueue'
import { AiError } from '@/lib/ai/types'

/**
 * POST /api/ai/knowledge/scrape  (admin+)
 *
 * Paste a URL: scrape that page immediately, then follow same-host
 * product / blog / page links in the background.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const limit = checkRateLimit(`ai-kb-scrape:${userId}`, RATE_LIMITS.knowledgeScrape)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const raw = typeof body?.url === 'string' ? body.url : ''
    let start: { url: string; mode: 'page' | 'site' }
    try {
      start = startUrlAndMode(raw)
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'Invalid URL'
      return NextResponse.json({ error: message }, { status: 400 })
    }

    const running = await findRunningScrapeJob(supabase, accountId)
    if (running) {
      return NextResponse.json(
        {
          error: 'Already learning from a site. Wait for it to finish.',
          job: publicScrapeJob(running),
        },
        { status: 409 },
      )
    }

    const job = await createScrapeJob(supabase, {
      accountId,
      userId,
      startUrl: start.url,
      mode: start.mode,
    })

    let started
    try {
      started = await scrapeStartPage(supabase, job)
    } catch (err) {
      const message =
        err instanceof AiError ? err.message : 'Could not learn from this link.'
      await markScrapeJobFailed(supabase, job.id, message)
      return NextResponse.json({ error: message, id: job.id }, { status: 422 })
    }

    if (started.status === 'running' && started.pending_urls.length > 0) {
      const queued = await enqueueKnowledgeScrape({
        jobId: started.id,
        accountId,
      })
      if (!queued) {
        after(() => continueKnowledgeScrapeJob(started.id))
      }
    }

    return NextResponse.json({
      success: true,
      job: publicScrapeJob(started),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
