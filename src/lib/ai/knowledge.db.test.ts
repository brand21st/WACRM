/**
 * Live DB + scrape checks for knowledge RAG. Skips without .env.local.
 * Writes only a marked [WACRM-KB-TEST] document and deletes it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, describe, expect, it } from 'vitest'
import { ingestDocument, retrieveKnowledge } from './knowledge'
import { fetchScrapedPage } from './scrape'
import { parseYoutubeVideoId } from './scrape-url'
import { upsertScrapedDocument } from './scrape-job'
import { retrieveShopifyStoreContent } from '@/lib/shopify/store-content'
import { fetchYoutubeKnowledgePage } from './youtube-transcript'

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq)
    let value = trimmed.slice(eq + 1)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvLocal()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const TEST_TITLE = '[WACRM-KB-TEST] About TestCo'

const describeLive = url && serviceKey ? describe : describe.skip

describeLive('knowledge RAG live DB', () => {
  const db = createClient(url!, serviceKey!)
  const createdIds: string[] = []

  afterAll(async () => {
    if (createdIds.length === 0) return
    await db.from('ai_knowledge_documents').delete().in('id', createdIds)
  })

  it('retrieves a just-ingested document for a company question', async () => {
    const { data: account, error: acctErr } = await db
      .from('accounts')
      .select('id')
      .limit(1)
      .maybeSingle()
    expect(acctErr).toBeNull()
    expect(account?.id).toBeTruthy()
    const accountId = account!.id as string

    const { data: doc, error: insErr } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        title: TEST_TITLE,
        content:
          'TestCo is a handmade bag company based in Kerala. Customer care is 1800-TEST-CO.',
        source_type: 'manual',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    expect(doc?.id).toBeTruthy()
    createdIds.push(doc!.id)

    await ingestDocument(
      db,
      accountId,
      { embeddingsApiKey: null },
      doc!.id,
      'TestCo is a handmade bag company based in Kerala. Customer care is 1800-TEST-CO.',
      TEST_TITLE,
    )

    const hits = await retrieveKnowledge(
      db,
      accountId,
      { embeddingsApiKey: null },
      'tell me about the company',
      8,
    )
    expect(hits.some((h) => h.includes('TestCo') && h.includes('1800-TEST-CO'))).toBe(
      true,
    )

    const { data: rpc, error: rpcErr } = await db.rpc('match_ai_knowledge_fallback', {
      p_account_id: accountId,
      p_query: 'company',
      p_match_count: 8,
    })
    expect(rpcErr).toBeNull()
    expect(
      (rpc as { content?: string }[] | null)?.some((row) =>
        String(row.content ?? '').includes('TestCo'),
      ),
    ).toBe(true)
  })

  it('retrieves a customer-care document for “Give your contact number”', async () => {
    const { data: account, error: acctErr } = await db
      .from('accounts')
      .select('id')
      .limit(1)
      .maybeSingle()
    expect(acctErr).toBeNull()
    expect(account?.id).toBeTruthy()
    const accountId = account!.id as string

    const { data: doc, error: insErr } = await db
      .from('ai_knowledge_documents')
      .insert({
        account_id: accountId,
        title: '[WACRM-KB-TEST] customer care number',
        content: 'Customer Care: please contact us at 1800-CARE-00.',
        source_type: 'manual',
      })
      .select('id')
      .single()
    expect(insErr).toBeNull()
    expect(doc?.id).toBeTruthy()
    createdIds.push(doc!.id)

    await ingestDocument(
      db,
      accountId,
      { embeddingsApiKey: null },
      doc!.id,
      'Customer Care: please contact us at 1800-CARE-00.',
      '[WACRM-KB-TEST] customer care number',
    )

    const hits = await retrieveKnowledge(
      db,
      accountId,
      { embeddingsApiKey: null },
      'Give your contact number',
      8,
    )
    expect(hits.some((h) => h.includes('1800-CARE-00'))).toBe(true)
  })

  it('returns the live customer-care number for “Give your contact number”', async () => {
    const { data: doc } = await db
      .from('ai_knowledge_documents')
      .select('account_id, content')
      .eq('title', 'customer care number')
      .limit(1)
      .maybeSingle()
    if (!doc?.account_id || !String(doc.content ?? '').includes('95441')) return

    const hits = await retrieveKnowledge(
      db,
      doc.account_id as string,
      { embeddingsApiKey: null },
      'Give your contact number',
      5,
    )
    expect(hits[0]).toMatch(/95441\s*61100/)
  })

  it('retrieves store hours and COD from live knowledge docs', async () => {
    const { data: hours } = await db
      .from('ai_knowledge_documents')
      .select('account_id, content')
      .eq('title', 'Store hours')
      .limit(1)
      .maybeSingle()
    if (hours?.account_id && String(hours.content ?? '').includes('9am')) {
      const hits = await retrieveKnowledge(
        db,
        hours.account_id as string,
        { embeddingsApiKey: null },
        'what time are you open',
        5,
      )
      expect(hits[0]).toMatch(/9am|9 am|Monday/i)
    }

    const { data: care } = await db
      .from('ai_knowledge_documents')
      .select('account_id, content')
      .eq('title', 'customer care number')
      .limit(1)
      .maybeSingle()
    if (care?.account_id && /COD/i.test(String(care.content ?? ''))) {
      const hits = await retrieveKnowledge(
        db,
        care.account_id as string,
        { embeddingsApiKey: null },
        'do you have COD',
        5,
      )
      expect(hits[0]).toMatch(/COD|Cash on Delivery/i)
    }
  })

  it('scrapes a public page into readable text', async () => {
    const page = await fetchScrapedPage('https://example.com/')
    expect(page.title.toLowerCase()).toMatch(/example/)
    expect(page.content.length).toBeGreaterThan(40)
    expect(page.url).toContain('example.com')
  }, 30_000)

  it('persists a scraped page and retrieves it from Postgres', async () => {
    const { data: account } = await db.from('accounts').select('id').limit(1).maybeSingle()
    expect(account?.id).toBeTruthy()
    const page = await fetchScrapedPage('https://example.com/')
    const documentId = await upsertScrapedDocument(
      db,
      account!.id as string,
      null,
      null,
      {
        url: 'https://example.com/?wacrm-kb-test=1',
        title: `${TEST_TITLE} Example`,
        content: page.content,
      },
    )
    createdIds.push(documentId)

    const hits = await retrieveKnowledge(
      db,
      account!.id as string,
      { embeddingsApiKey: null },
      'illustrative examples',
      8,
    )
    expect(hits.some((h) => h.toLowerCase().includes('example'))).toBe(true)
  }, 30_000)

  it('retrieves synced Shopify policies for a company/shipping question', async () => {
    const { data: store } = await db
      .from('shopify_store_content')
      .select('account_id, body')
      .not('body', 'eq', '')
      .limit(1)
      .maybeSingle()
    if (!store?.account_id || String(store.body ?? '').length < 40) return

    const hits = await retrieveShopifyStoreContent(
      db,
      store.account_id as string,
      'tell me about the shipping policy',
      5,
    )
    expect(hits.some((h) => /shipping|policy/i.test(h))).toBe(true)
  })

  it('parses YouTube ids and fetches a captioned video when YouTube allows timedtext', async () => {
    expect(parseYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    try {
      const page = await fetchYoutubeKnowledgePage(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      )
      expect(page.title.length).toBeGreaterThan(0)
      expect(page.content.length).toBeGreaterThan(40)
      expect(page.url).toContain('dQw4w9WgXcQ')
    } catch (error) {
      expect(error).toMatchObject({ code: 'youtube_no_captions' })
    }
  }, 30_000)
})
