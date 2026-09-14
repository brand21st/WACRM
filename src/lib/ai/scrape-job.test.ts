import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const h = vi.hoisted(() => ({
  ingestDocument: vi.fn(),
  fetchScrapedPage: vi.fn(),
  fetchYoutubeKnowledgePage: vi.fn(),
  loadEmbeddingsKey: vi.fn(),
  adminDb: null as unknown,
}))

vi.mock('./knowledge', () => ({
  ingestDocument: (...args: unknown[]) => h.ingestDocument(...args),
}))
vi.mock('./scrape', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scrape')>()
  return {
    ...actual,
    fetchScrapedPage: (...args: unknown[]) => h.fetchScrapedPage(...args),
  }
})
vi.mock('./youtube-transcript', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./youtube-transcript')>()
  return {
    ...actual,
    fetchYoutubeKnowledgePage: (...args: unknown[]) =>
      h.fetchYoutubeKnowledgePage(...args),
  }
})
vi.mock('./config', () => ({
  loadEmbeddingsKey: (...args: unknown[]) => h.loadEmbeddingsKey(...args),
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => h.adminDb,
}))

import {
  continueKnowledgeScrapeJob,
  currentLearningUrl,
  publicScrapeJob,
  scrapeStartPage,
  upsertScrapedDocument,
} from './scrape-job'
import { AiError } from './types'

function jobDb(insertedId = 'doc-1') {
  const updates: Record<string, unknown>[] = []
  const inserts: Record<string, unknown>[] = []
  const db = {
    from: (table: string) => {
      if (table === 'ai_knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserts.push(row)
            return {
              select: () => ({
                single: async () => ({ data: { id: insertedId }, error: null }),
              }),
            }
          },
          update: (row: Record<string, unknown>) => {
            updates.push(row)
            return {
              eq: () => ({
                eq: async () => ({ error: null }),
              }),
            }
          },
        }
      }
      if (table === 'ai_knowledge_scrape_jobs') {
        return {
          update: (row: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: async () => ({
                  data: {
                    id: 'job-1',
                    account_id: 'acct',
                    created_by: 'user',
                    start_url: 'https://shop.example.com/pages/about',
                    mode: 'page',
                    status: row.status ?? 'done',
                    pages_found: row.pages_found ?? 1,
                    pages_saved: row.pages_saved ?? 1,
                    pages_failed: row.pages_failed ?? 0,
                    error: row.error ?? null,
                    pending_urls: row.pending_urls ?? [],
                    visited_urls: row.visited_urls ?? [],
                  },
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      return {}
    },
  }
  return { db: db as unknown as SupabaseClient, inserts, updates }
}

function continueJobDb(jobRow: Record<string, unknown>) {
  const patches: Record<string, unknown>[] = []
  const db = {
    from: (table: string) => {
      if (table === 'ai_knowledge_documents') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: 'doc-2' }, error: null }),
            }),
          }),
          update: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }
      }
      if (table === 'ai_knowledge_scrape_jobs') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { ...jobRow }, error: null }),
            }),
          }),
          update: (row: Record<string, unknown>) => {
            patches.push(row)
            Object.assign(jobRow, row)
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({ data: { ...jobRow }, error: null }),
                }),
              }),
            }
          },
        }
      }
      return {}
    },
  }
  return { db: db as unknown as SupabaseClient, patches, jobRow }
}

beforeEach(() => {
  h.ingestDocument.mockReset()
  h.fetchScrapedPage.mockReset()
  h.fetchYoutubeKnowledgePage.mockReset()
  h.loadEmbeddingsKey.mockReset()
  h.loadEmbeddingsKey.mockResolvedValue({ key: null })
  h.ingestDocument.mockResolvedValue(undefined)
  h.adminDb = null
})

describe('upsertScrapedDocument', () => {
  it('saves a document and chunks with the page title', async () => {
    const { db, inserts } = jobDb()
    const id = await upsertScrapedDocument(db, 'acct', 'user', null, {
      url: 'https://shop.example.com/about',
      title: 'About',
      content: 'We make bags in Kerala.',
    })
    expect(id).toBe('doc-1')
    expect(inserts[0]).toMatchObject({
      title: 'About',
      source_type: 'url',
      source_url: 'https://shop.example.com/about',
    })
    expect(h.ingestDocument).toHaveBeenCalledWith(
      db,
      'acct',
      { embeddingsApiKey: null },
      'doc-1',
      'We make bags in Kerala.',
      'About',
    )
  })

  it('records scrape_error and throws when chunk insert fails', async () => {
    const { db, updates } = jobDb()
    h.ingestDocument.mockRejectedValueOnce(new Error('insert failed'))
    await expect(
      upsertScrapedDocument(db, 'acct', 'user', null, {
        url: 'https://shop.example.com/about',
        title: 'About',
        content: 'We make bags.',
      }),
    ).rejects.toThrow('insert failed')
    expect(updates.some((u) => u.scrape_error === 'insert failed')).toBe(true)
  })

  it('keeps the document when only embeddings fail', async () => {
    const { db } = jobDb()
    h.ingestDocument.mockRejectedValueOnce(
      new AiError('rate limited', { code: 'embed_failed' }),
    )
    await expect(
      upsertScrapedDocument(db, 'acct', 'user', 'sk-x', {
        url: 'https://shop.example.com/about',
        title: 'About',
        content: 'We make bags.',
      }),
    ).resolves.toBe('doc-1')
  })
})

describe('scrapeStartPage', () => {
  it('uses the YouTube transcript path instead of HTML scrape', async () => {
    const { db } = jobDb()
    h.fetchYoutubeKnowledgePage.mockResolvedValueOnce({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      title: 'About Acme',
      content: 'About Acme\n\nWe make bags.',
      links: [],
    })
    const next = await scrapeStartPage(db, {
      id: 'job-1',
      account_id: 'acct',
      created_by: 'user',
      start_url: 'https://youtu.be/dQw4w9WgXcQ',
      mode: 'page',
      status: 'running',
      pages_found: 0,
      pages_saved: 0,
      pages_failed: 0,
      error: null,
      pending_urls: [],
      visited_urls: [],
    })
    expect(h.fetchScrapedPage).not.toHaveBeenCalled()
    expect(h.fetchYoutubeKnowledgePage).toHaveBeenCalled()
    expect(next.pages_saved).toBe(1)
    expect(next.status).toBe('done')
  })
})

describe('currentLearningUrl / publicScrapeJob', () => {
  const base = {
    id: 'job-1',
    account_id: 'acct',
    created_by: 'user',
    start_url: 'https://shop.example.com/',
    mode: 'page' as const,
    status: 'running' as const,
    pages_found: 2,
    pages_saved: 1,
    pages_failed: 0,
    error: null,
    pending_urls: [] as { url: string; depth: number }[],
    visited_urls: [] as string[],
  }

  it('prefers the first pending URL', () => {
    expect(
      currentLearningUrl({
        start_url: base.start_url,
        pending_urls: [{ url: 'https://shop.example.com/pages/about', depth: 1 }],
        visited_urls: [base.start_url],
      }),
    ).toBe('https://shop.example.com/pages/about')
  })

  it('falls back to the last visited URL, then start_url', () => {
    expect(
      currentLearningUrl({
        start_url: base.start_url,
        pending_urls: [],
        visited_urls: [base.start_url, 'https://shop.example.com/pages/faq'],
      }),
    ).toBe('https://shop.example.com/pages/faq')
    expect(
      currentLearningUrl({
        start_url: base.start_url,
        pending_urls: [],
        visited_urls: [],
      }),
    ).toBe(base.start_url)
  })

  it('exposes current_url on the public job', () => {
    const publicJob = publicScrapeJob({
      ...base,
      pending_urls: [{ url: 'https://www.youtube.com/watch?v=abc123', depth: 0 }],
    })
    expect(publicJob.current_url).toBe('https://www.youtube.com/watch?v=abc123')
    expect(publicJob.start_url).toBe(base.start_url)
  })
})

describe('continueKnowledgeScrapeJob', () => {
  it('writes the next page URL before fetching so polls can show it', async () => {
    const { db, patches } = continueJobDb({
      id: 'job-1',
      account_id: 'acct',
      created_by: 'user',
      start_url: 'https://shop.example.com/',
      mode: 'page',
      status: 'running',
      pages_found: 2,
      pages_saved: 1,
      pages_failed: 0,
      error: null,
      pending_urls: [{ url: 'https://shop.example.com/pages/about', depth: 1 }],
      visited_urls: ['https://shop.example.com/'],
    })
    h.adminDb = db
    h.fetchScrapedPage.mockImplementation(async (url: string) => {
      expect(patches[0]).toMatchObject({
        status: 'running',
        pending_urls: [{ url: 'https://shop.example.com/pages/about', depth: 1 }],
      })
      return {
        url,
        title: 'About',
        content: 'We make handmade bags in Kerala for everyday use.',
        links: [],
      }
    })

    await continueKnowledgeScrapeJob('job-1')

    expect(h.fetchScrapedPage).toHaveBeenCalledWith(
      'https://shop.example.com/pages/about',
    )
    expect(patches[0]?.pending_urls).toEqual([
      { url: 'https://shop.example.com/pages/about', depth: 1 },
    ])
    expect(currentLearningUrl({
      start_url: 'https://shop.example.com/',
      pending_urls: patches[0]?.pending_urls as { url: string; depth: number }[],
      visited_urls: patches[0]?.visited_urls as string[],
    })).toBe('https://shop.example.com/pages/about')
    expect(patches.at(-1)).toMatchObject({ status: 'done', pages_saved: 2 })
  })
})
