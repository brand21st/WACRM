/**
 * Live API + DB checks for knowledge routes. Auth is replaced with the
 * service-role client so we exercise the real handlers against Postgres.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

const live = vi.hoisted(() => ({
  accountId: '',
  userId: 'wacrm-kb-live-test',
  db: null as ReturnType<typeof createClient> | null,
}))

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>(
    '@/lib/auth/account',
  )
  return {
    ...actual,
    getCurrentAccount: async () => ({
      supabase: live.db,
      accountId: live.accountId,
      userId: live.userId,
    }),
    requireRole: async () => ({
      supabase: live.db,
      accountId: live.accountId,
      userId: live.userId,
    }),
  }
})

import { GET as getKnowledge, POST as postKnowledge } from './route'
import { GET as getShopifyContent } from '@/app/api/shopify/content/sync/route'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const describeLive = url && serviceKey ? describe : describe.skip
const TEST_TITLE = '[WACRM-KB-TEST] API About TestCo'

describeLive('knowledge + shopify content APIs against live DB', () => {
  const createdIds: string[] = []

  beforeAll(async () => {
    live.db = createClient(url!, serviceKey!)
    const { data } = await live.db
      .from('accounts')
      .select('id')
      .eq('name', 'Samanga')
      .maybeSingle()
    live.accountId = (data?.id as string | undefined) ?? ''
    if (!live.accountId) {
      const fallback = await live.db.from('accounts').select('id').limit(1).maybeSingle()
      live.accountId = (fallback.data?.id as string | undefined) ?? ''
    }
    const { data: existing } = await live.db
      .from('ai_knowledge_documents')
      .select('created_by')
      .eq('account_id', live.accountId)
      .not('created_by', 'is', null)
      .limit(1)
      .maybeSingle()
    if (existing?.created_by) live.userId = existing.created_by as string
  })

  afterAll(async () => {
    if (!live.db || createdIds.length === 0) return
    await live.db.from('ai_knowledge_documents').delete().in('id', createdIds)
  })

  it('GET /api/ai/knowledge lists documents for the account', async () => {
    expect(live.accountId).toBeTruthy()
    const res = await getKnowledge()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { documents?: { title?: string }[] }
    expect(Array.isArray(body.documents)).toBe(true)
    expect(body.documents!.length).toBeGreaterThan(0)
  })

  it('POST /api/ai/knowledge saves title+body and they become retrievable', async () => {
    expect(live.accountId).toBeTruthy()
    const res = await postKnowledge(
      new Request('https://app.test/api/ai/knowledge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: TEST_TITLE,
          content:
            'API TestCo sells handmade bags in Kerala. Support line is 1800-API-TEST.',
        }),
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id?: string; success?: boolean }
    expect(body.id).toBeTruthy()
    createdIds.push(body.id!)

    const { data } = await live.db!
      .from('ai_knowledge_documents')
      .select('title, content')
      .eq('id', body.id!)
      .single()
    expect(data?.title).toBe(TEST_TITLE)
    expect(String(data?.content ?? '')).toContain('1800-API-TEST')

    const { retrieveKnowledge } = await import('@/lib/ai/knowledge')
    const hits = await retrieveKnowledge(
      live.db!,
      live.accountId,
      { embeddingsApiKey: null },
      'API TestCo 1800-API-TEST',
      8,
    )
    expect(hits.some((h) => h.includes('API TestCo') && h.includes('1800-API-TEST'))).toBe(
      true,
    )
  })

  it('GET /api/shopify/content/sync lists synced pages and policies', async () => {
    expect(live.accountId).toBeTruthy()
    const res = await getShopifyContent()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      items?: { title?: string; kind?: string }[]
      count?: number
    }
    expect(body.count).toBeGreaterThan(0)
    expect(body.items?.some((item) => /shipping|privacy|about/i.test(item.title ?? ''))).toBe(
      true,
    )
  })
})
