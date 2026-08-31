/**
 * Probe whether a delivery-time question can retrieve Shopify shipping copy.
 * Usage: npx tsx scripts/test-delivery-retrieve.mts
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvLocal() {
  try {
    const text = readFileSync('.env.local', 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq <= 0) continue
      const key = trimmed.slice(0, eq).trim()
      let val = trimmed.slice(eq + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      if (!process.env[key]) process.env[key] = val
    }
  } catch {
    // optional
  }
}

loadEnvLocal()

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const ACCOUNT = '816f55c7-3d0b-490c-881f-9a13f673ac46'
const QUERY = 'product delivery time'

const { data: docs, error: docsErr } = await db
  .from('ai_knowledge_documents')
  .select('id, title, content')
  .eq('account_id', ACCOUNT)
  .like('title', '[Shopify]%')

console.log('kb error', docsErr?.message ?? null)
console.log(
  'shopify kb titles',
  (docs ?? []).map((d) => `${d.title} (${(d.content || '').length} chars)`),
)
for (const d of docs ?? []) {
  const c = (d.content || '').toLowerCase()
  if (
    /ship|deliver|dispatch|transit|business day|working day/.test(c) ||
    /ship|deliver/.test(d.title.toLowerCase())
  ) {
    console.log('---', d.title)
    console.log((d.content || '').slice(0, 500))
  }
}

const { data: fts, error: ftsErr } = await db.rpc('match_ai_knowledge_fts', {
  p_account_id: ACCOUNT,
  p_query: QUERY,
  p_match_count: 5,
})
console.log('fts error', ftsErr?.message ?? null)
console.log(
  'fts for',
  QUERY,
  (fts ?? []).map((r: { content?: string }) => (r.content || '').slice(0, 80)),
)

const { retrieveShopifyStoreContent } = await import(
  '../src/lib/shopify/store-content'
)
const store = await retrieveShopifyStoreContent(db, ACCOUNT, QUERY, 5)
console.log('retrieveShopifyStoreContent', store.map((s) => s.slice(0, 200)))
