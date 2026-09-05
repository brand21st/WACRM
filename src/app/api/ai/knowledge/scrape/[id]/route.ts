import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { publicScrapeJob } from '@/lib/ai/scrape-job'

type Params = { params: Promise<{ id: string }> }

/**
 * GET /api/ai/knowledge/scrape/[id]
 *
 * Poll scrape-job progress after a pasted URL.
 */
export async function GET(_request: Request, { params }: Params) {
  try {
    const { supabase, accountId } = await getCurrentAccount()
    const { id } = await params
    const { data, error } = await supabase
      .from('ai_knowledge_scrape_jobs')
      .select(
        'id, account_id, created_by, start_url, mode, status, pages_found, pages_saved, pages_failed, error, pending_urls, visited_urls',
      )
      .eq('account_id', accountId)
      .eq('id', id)
      .maybeSingle()
    if (error) {
      console.error('[ai/knowledge/scrape GET] error:', error)
      return NextResponse.json({ error: 'Failed to load scrape job' }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      job: publicScrapeJob({
        ...data,
        pending_urls: Array.isArray(data.pending_urls) ? data.pending_urls : [],
        visited_urls: Array.isArray(data.visited_urls) ? data.visited_urls : [],
      }),
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}
