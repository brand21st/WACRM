import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  findRunningScrapeJob: vi.fn(),
  createScrapeJob: vi.fn(),
  scrapeStartPage: vi.fn(),
  markScrapeJobFailed: vi.fn(),
  enqueueKnowledgeScrape: vi.fn(),
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>(
    '@/lib/auth/account',
  )
  return {
    ...actual,
    requireRole: mocks.requireRole,
  }
})

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: () => ({ success: true }),
  rateLimitResponse: () => Response.json({ error: 'rate limited' }, { status: 429 }),
  RATE_LIMITS: { knowledgeScrape: { limit: 10, windowMs: 60_000 } },
}))

vi.mock('@/lib/ai/scrape-job', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/scrape-job')>()
  return {
    ...actual,
    findRunningScrapeJob: (...args: unknown[]) => mocks.findRunningScrapeJob(...args),
    createScrapeJob: (...args: unknown[]) => mocks.createScrapeJob(...args),
    scrapeStartPage: (...args: unknown[]) => mocks.scrapeStartPage(...args),
    markScrapeJobFailed: (...args: unknown[]) => mocks.markScrapeJobFailed(...args),
  }
})

vi.mock('@/lib/queue/enqueue', () => ({
  enqueueKnowledgeScrape: (...args: unknown[]) => mocks.enqueueKnowledgeScrape(...args),
}))

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (fn: () => unknown) => fn() }
})

import { POST } from './route'

const JOB = {
  id: 'job-1',
  start_url: 'https://shop.example.com/pages/about',
  mode: 'page' as const,
  status: 'done' as const,
  pages_found: 1,
  pages_saved: 1,
  pages_failed: 0,
  error: null,
  pending_urls: [] as { url: string; depth: number }[],
  visited_urls: ['https://shop.example.com/pages/about'],
  account_id: 'acct-1',
  created_by: 'user-1',
}

beforeEach(() => {
  mocks.requireRole.mockReset()
  mocks.findRunningScrapeJob.mockReset()
  mocks.createScrapeJob.mockReset()
  mocks.scrapeStartPage.mockReset()
  mocks.markScrapeJobFailed.mockReset()
  mocks.enqueueKnowledgeScrape.mockReset()
  mocks.requireRole.mockResolvedValue({
    supabase: {},
    accountId: 'acct-1',
    userId: 'user-1',
  })
  mocks.findRunningScrapeJob.mockResolvedValue(null)
  mocks.createScrapeJob.mockResolvedValue(JOB)
  mocks.scrapeStartPage.mockResolvedValue(JOB)
  mocks.enqueueKnowledgeScrape.mockResolvedValue(true)
})

describe('POST /api/ai/knowledge/scrape', () => {
  it('starts a scrape job', async () => {
    const res = await POST(
      new Request('https://app.test/api/ai/knowledge/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://shop.example.com/pages/about' }),
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.job.id).toBe('job-1')
    expect(mocks.createScrapeJob).toHaveBeenCalled()
    expect(mocks.scrapeStartPage).toHaveBeenCalled()
  })

  it('rejects an invalid URL', async () => {
    const res = await POST(
      new Request('https://app.test/api/ai/knowledge/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'not-a-link' }),
      }),
    )
    expect(res.status).toBe(400)
    expect(mocks.createScrapeJob).not.toHaveBeenCalled()
  })

  it('returns 409 when a job is already running', async () => {
    mocks.findRunningScrapeJob.mockResolvedValueOnce({
      ...JOB,
      status: 'running',
    })
    const res = await POST(
      new Request('https://app.test/api/ai/knowledge/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://shop.example.com/pages/faq' }),
      }),
    )
    expect(res.status).toBe(409)
    expect(mocks.createScrapeJob).not.toHaveBeenCalled()
  })
})
