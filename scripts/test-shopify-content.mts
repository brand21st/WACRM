/**
 * Live check: load Shopify config, sync store content, print counts.
 * Usage: npx tsx scripts/test-shopify-content.mts
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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!process.env.ENCRYPTION_KEY) {
  console.error('Missing ENCRYPTION_KEY')
  process.exit(1)
}

const db = createClient(url, key)
const { loadShopifyConfig } = await import('../src/lib/shopify/config')
const { syncCatalog } = await import('../src/lib/shopify/catalog')
const { syncStoreContent, searchStoreContent } = await import(
  '../src/lib/shopify/store-content'
)

const { data: rows, error } = await db
  .from('shopify_configs')
  .select('account_id, shop_domain')
  .limit(5)

if (error) {
  console.error('shopify_configs query failed:', error.message)
  process.exit(1)
}

if (!rows?.length) {
  console.log('No Shopify configs found.')
  process.exit(0)
}

for (const row of rows) {
  console.log('---')
  console.log('account', row.account_id)
  console.log('shop', row.shop_domain)
  try {
    const config = await loadShopifyConfig(db, row.account_id, {
      requireActive: false,
    })
    if (!config) {
      console.log('skip: config not loadable')
      continue
    }
    const { shopifyGraphql } = await import('../src/lib/shopify/client')
    const { SHOP_POLICIES_QUERY, PAGES_SYNC_QUERY } = await import(
      '../src/lib/shopify/queries'
    )
    try {
      const policies = await shopifyGraphql<{
        shop?: { shopPolicies?: { type?: string; title?: string }[] }
      }>({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        query: SHOP_POLICIES_QUERY,
      })
      console.log(
        'live policies',
        (policies.shop?.shopPolicies ?? []).map((p) => p.title || p.type),
      )
    } catch (err) {
      console.error(
        'policy GraphQL failed:',
        err instanceof Error ? err.message : err,
      )
    }
    try {
      const pages = await shopifyGraphql<{
        pages?: { nodes?: { handle?: string; title?: string; isPublished?: boolean }[] }
      }>({
        shopDomain: config.shopDomain,
        accessToken: config.accessToken,
        query: PAGES_SYNC_QUERY,
        variables: { first: 20, after: null },
      })
      console.log(
        'live pages',
        (pages.pages?.nodes ?? []).map((p) => `${p.title} (${p.handle}, published=${p.isPublished})`),
      )
    } catch (err) {
      console.error(
        'pages GraphQL failed:',
        err instanceof Error ? err.message : err,
      )
    }
    const catalog = await syncCatalog(db, config)
    console.log('catalog synced', catalog.count)
    const { data: meta } = await db
      .from('shopify_configs')
      .select('last_catalog_sync_at, catalog_product_count')
      .eq('account_id', row.account_id)
      .maybeSingle()
    console.log('config after catalog', meta)
    const result = await syncStoreContent(db, config)
    console.log('synced count', result.count, result.warning ?? '')
    const { data: kb } = await db
      .from('ai_knowledge_documents')
      .select('title')
      .eq('account_id', row.account_id)
      .like('title', '[Shopify]%')
    console.log(
      'knowledge docs',
      (kb ?? []).map((d) => d.title),
    )
    const hits = await searchStoreContent(db, row.account_id, 'policy return shipping about contact faq', 5)
    for (const hit of hits) {
      console.log(`  ${hit.kind}: ${hit.title} (${hit.handle ?? ''}) ${hit.body.slice(0, 80)}`)
    }
    if (hits.length === 0) {
      const { data: all } = await db
        .from('shopify_store_content')
        .select('kind, title, handle')
        .eq('account_id', row.account_id)
        .limit(20)
      console.log('rows in table:', all)
    }
  } catch (err) {
    console.error('sync failed:', err instanceof Error ? err.message : err)
  }
}
