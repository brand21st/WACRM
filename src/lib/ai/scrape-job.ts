import type { SupabaseClient } from '@supabase/supabase-js'

import { supabaseAdmin } from './admin-client'
import { loadEmbeddingsKey } from './config'
import { ingestDocument } from './knowledge'
import {
  canonicalizeUrl,
  depthLimitForMode,
  fetchScrapedPage,
  pageLimitForMode,
  parsePublicHttpUrl,
  prioritizeKnowledgeLinks,
  scrapeModeForUrl,
  type PendingPage,
  type ScrapeMode,
} from './scrape'
import { AiError } from './types'

export interface KnowledgeScrapeJobRow {
  id: string
  account_id: string
  created_by: string | null
  start_url: string
  mode: ScrapeMode
  status: 'queued' | 'running' | 'done' | 'failed'
  pages_found: number
  pages_saved: number
  pages_failed: number
  error: string | null
  pending_urls: PendingPage[]
  visited_urls: string[]
}

export function publicScrapeJob(row: KnowledgeScrapeJobRow) {
  return {
    id: row.id,
    start_url: row.start_url,
    mode: row.mode,
    status: row.status,
    pages_found: row.pages_found,
    pages_saved: row.pages_saved,
    pages_failed: row.pages_failed,
    error: row.error,
  }
}

export async function findRunningScrapeJob(
  db: SupabaseClient,
  accountId: string,
): Promise<KnowledgeScrapeJobRow | null> {
  const { data, error } = await db
    .from('ai_knowledge_scrape_jobs')
    .select(
      'id, account_id, created_by, start_url, mode, status, pages_found, pages_saved, pages_failed, error, pending_urls, visited_urls',
    )
    .eq('account_id', accountId)
    .in('status', ['queued', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? normalizeJob(data) : null
}

export async function createScrapeJob(
  db: SupabaseClient,
  args: {
    accountId: string
    userId: string
    startUrl: string
    mode: ScrapeMode
  },
): Promise<KnowledgeScrapeJobRow> {
  const { data, error } = await db
    .from('ai_knowledge_scrape_jobs')
    .insert({
      account_id: args.accountId,
      created_by: args.userId,
      start_url: args.startUrl,
      mode: args.mode,
      status: 'running',
      pending_urls: [],
      visited_urls: [],
    })
    .select(
      'id, account_id, created_by, start_url, mode, status, pages_found, pages_saved, pages_failed, error, pending_urls, visited_urls',
    )
    .single()
  if (error || !data) {
    throw new AiError('Failed to start learning from that link.', {
      code: 'job_create_failed',
      status: 500,
    })
  }
  return normalizeJob(data)
}

export async function upsertScrapedDocument(
  db: SupabaseClient,
  accountId: string,
  userId: string | null,
  embeddingsApiKey: string | null,
  page: { url: string; title: string; content: string },
): Promise<string> {
  const { data: existing, error: findErr } = await db
    .from('ai_knowledge_documents')
    .select('id')
    .eq('account_id', accountId)
    .eq('source_url', page.url)
    .maybeSingle()
  if (findErr) throw findErr

  const now = new Date().toISOString()
  let documentId = existing?.id as string | undefined
  if (documentId) {
    const { error } = await db
      .from('ai_knowledge_documents')
      .update({
        title: page.title,
        content: page.content,
        source_type: 'url',
        last_scraped_at: now,
        scrape_error: null,
      })
      .eq('id', documentId)
      .eq('account_id', accountId)
    if (error) throw error
  } else {
    const { data: inserted, error } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        created_by: userId,
        title: page.title,
        content: page.content,
        source_type: 'url',
        source_url: page.url,
        last_scraped_at: now,
        scrape_error: null,
      })
      .select('id')
      .single()
    if (error || !inserted?.id) throw error ?? new Error('insert failed')
    documentId = inserted.id
  }
  if (!documentId) throw new Error('insert failed')

  try {
    await ingestDocument(db, accountId, { embeddingsApiKey }, documentId, page.content)
  } catch (err) {
    console.error('[ai scrape] ingest warning:', err)
  }
  return documentId
}

export async function scrapeStartPage(
  db: SupabaseClient,
  job: KnowledgeScrapeJobRow,
): Promise<KnowledgeScrapeJobRow> {
  const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, job.account_id)
  const page = await fetchScrapedPage(job.start_url)
  await upsertScrapedDocument(
    db,
    job.account_id,
    job.created_by,
    embeddingsApiKey,
    page,
  )
  const visited = [page.url]
  const remaining = pageLimitForMode(job.mode) - 1
  const follow = prioritizeKnowledgeLinks(page.links)
    .filter((url) => url !== page.url)
    .slice(0, remaining)
  const pending: PendingPage[] = follow.map((url) => ({ url, depth: 1 }))
  return saveJob(db, job.id, {
    status: pending.length > 0 ? 'running' : 'done',
    pages_found: 1 + pending.length,
    pages_saved: 1,
    pages_failed: 0,
    pending_urls: pending,
    visited_urls: visited,
    error: null,
  })
}

export async function continueKnowledgeScrapeJob(jobId: string): Promise<void> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('ai_knowledge_scrape_jobs')
    .select(
      'id, account_id, created_by, start_url, mode, status, pages_found, pages_saved, pages_failed, error, pending_urls, visited_urls',
    )
    .eq('id', jobId)
    .maybeSingle()
  if (error) throw error
  if (!data) return
  let job = normalizeJob(data)
  if (job.status === 'done' || job.status === 'failed') return

  const { key: embeddingsApiKey } = await loadEmbeddingsKey(db, job.account_id)
  const maxPages = pageLimitForMode(job.mode)
  const maxDepth = depthLimitForMode(job.mode)
  const visited = new Set(job.visited_urls)
  const pending = [...job.pending_urls]
  let saved = job.pages_saved
  let failed = job.pages_failed
  let found = job.pages_found

  while (pending.length > 0 && saved + failed < maxPages) {
    const next = pending.shift()
    if (!next) break
    const url = next.url
    if (visited.has(url)) continue
    visited.add(url)
    try {
      const page = await fetchScrapedPage(url)
      await upsertScrapedDocument(
        db,
        job.account_id,
        job.created_by,
        embeddingsApiKey,
        page,
      )
      saved += 1
      if (next.depth < maxDepth && saved + failed + pending.length < maxPages) {
        const extra = prioritizeKnowledgeLinks(page.links).slice(
          0,
          maxPages - (saved + failed + pending.length),
        )
        for (const href of extra) {
          if (visited.has(href) || pending.some((p) => p.url === href)) continue
          pending.push({ url: href, depth: next.depth + 1 })
          found += 1
        }
      }
    } catch (err) {
      failed += 1
      console.error(
        '[ai scrape] page failed:',
        url,
        err instanceof Error ? err.message : err,
      )
    }
  }

  const done = pending.length === 0 || saved + failed >= maxPages
  await saveJob(db, job.id, {
    status: saved === 0 && done ? 'failed' : done ? 'done' : 'running',
    pages_found: found,
    pages_saved: saved,
    pages_failed: failed,
    pending_urls: done ? [] : pending,
    visited_urls: [...visited],
    error: saved === 0 && done ? 'Could not learn from this link.' : null,
  })
}

export function startUrlAndMode(raw: string): { url: string; mode: ScrapeMode } {
  const parsed = parsePublicHttpUrl(raw)
  return { url: canonicalizeUrl(parsed), mode: scrapeModeForUrl(parsed) }
}

function normalizeJob(row: Record<string, unknown>): KnowledgeScrapeJobRow {
  return {
    id: String(row.id),
    account_id: String(row.account_id),
    created_by: (row.created_by as string | null) ?? null,
    start_url: String(row.start_url),
    mode: row.mode === 'site' ? 'site' : 'page',
    status: row.status as KnowledgeScrapeJobRow['status'],
    pages_found: Number(row.pages_found ?? 0),
    pages_saved: Number(row.pages_saved ?? 0),
    pages_failed: Number(row.pages_failed ?? 0),
    error: (row.error as string | null) ?? null,
    pending_urls: Array.isArray(row.pending_urls)
      ? (row.pending_urls as PendingPage[])
      : [],
    visited_urls: Array.isArray(row.visited_urls)
      ? (row.visited_urls as string[])
      : [],
  }
}

async function saveJob(
  db: SupabaseClient,
  id: string,
  patch: Partial<
    Pick<
      KnowledgeScrapeJobRow,
      | 'status'
      | 'pages_found'
      | 'pages_saved'
      | 'pages_failed'
      | 'error'
      | 'pending_urls'
      | 'visited_urls'
    >
  >,
): Promise<KnowledgeScrapeJobRow> {
  const { data, error } = await db
    .from('ai_knowledge_scrape_jobs')
    .update(patch)
    .eq('id', id)
    .select(
      'id, account_id, created_by, start_url, mode, status, pages_found, pages_saved, pages_failed, error, pending_urls, visited_urls',
    )
    .single()
  if (error || !data) throw error ?? new Error('job update failed')
  return normalizeJob(data)
}

export async function markScrapeJobFailed(
  db: SupabaseClient,
  jobId: string,
  message: string,
): Promise<void> {
  await db
    .from('ai_knowledge_scrape_jobs')
    .update({ status: 'failed', error: message })
    .eq('id', jobId)
}
